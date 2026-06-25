'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  Layers,
  Bot,
  CheckCircle2,
  Clock3,
  Coins,
  Eye,
  FileClock,
  HelpCircle,
  Layers3,
  Map as MapIcon,
  Palette,
  PlusCircle,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  SmilePlus,
  ShoppingBag,
  Sparkles,
  Store,
  Swords,
  Target,
  Trash2,
  Trophy,
  Zap
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { borderClass, borderStyle, ensureCosmeticCss, parseStyle } from '@/lib/cosmetics';
import { useApp } from './AppContext';
import { ArenaAdminPanel } from './ArenaAdminPanel';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { StreamerTooltip } from './StreamerTooltip';
import type {
  ArenaBattlefieldRuleDto,
  ArenaDeckSnapshotDto,
  ArenaMatchViewDto,
  ArenaReplayEventDto,
  ArenaReplayPayloadDto,
  ArenaRulesCatalogDto,
  ArenaSnapshotCardDto,
  ArenaTacticChipDto
} from '@chikapo/arena-contract';

type ArenaCard = {
  card_id: string;
  channel_id: string;
  name: string;
  image_url: string | null;
  flavor_text?: string | null;
  arena_enabled: boolean;
  class: {
    id: string;
    name: string;
    role: string;
    description: string;
  };
  stats: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    focus: number;
  };
  skills: Array<{
    id: string;
    name: string;
    type: string;
    tags: string[];
    description: string;
  }>;
  ability_seed: string;
  owned_count?: number;
  max_star?: number;
};

type ArenaSystemStatus = {
  status: string;
  match_format: {
    set_rule: string;
    target_client_play_time_seconds: { min: number; max: number };
    server_simulation: string;
  };
  low_load_policy: {
    realtime_rooms: boolean;
    bot_replay_saved: boolean;
    ranked_workers: string;
    ranking_snapshot_limit: number;
    card_catalog_cache_ttl_ms: number;
  };
  fair_play_policy: {
    combat_uses_chikapo_market_or_live_data: boolean;
    chikapo_source_data_scope: string;
    forbidden_combat_fields: string[];
  };
};

type ArenaTacticChip = ArenaTacticChipDto;
type ArenaBattlefieldRule = ArenaBattlefieldRuleDto;
type ArenaRulesCatalog = ArenaRulesCatalogDto;

type ArenaSeason = {
  season: {
    id: string;
    name: string;
    phase: string;
    ranked_enabled: boolean;
    quick_match_enabled: boolean;
    bot_practice_enabled: boolean;
    mmr_enabled: boolean;
    ranking_enabled: boolean;
    cup_enabled?: boolean;
  };
};


type MyArenaStreamerCard = {
  channel_id: string;
  is_enabled: boolean;
  config_status: string;
  state?: {
    is_enabled: boolean;
    updated_at: string | null;
    disabled_at: string | null;
    enabled_at: string | null;
    reason: string | null;
    config?: ArenaStreamerCardConfig | null;
    configured_at?: string | null;
  };
  card?: ArenaCard;
  config_options?: ArenaStreamerCardConfigOptions;
};

type ArenaStreamerCardConfig = {
  class_id?: string;
  stat_focus?: keyof ArenaCard['stats'];
  combat_style?: string;
  skill_ids?: string[];
  tag_ids?: string[];
  flavor_text?: string;
};

type ArenaStreamerCardConfigOptions = {
  classes: ArenaCard['class'][];
  stat_focuses: Array<{ id: keyof ArenaCard['stats']; name: string; description: string }>;
  combat_styles: Array<{ id: string; name: string; description: string }>;
  skills_by_class: Record<string, ArenaCard['skills']>;
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
};

type ArenaDeck = {
  id: string;
  name: string;
  cards: Array<{ card_id: string; channel_id: string }>;
  strategy_chip_id: string;
  round_plans: Array<{
    round_no: number;
    formation_id?: string;
    tactic_style?: string;
    focus_rule?: string;
    slots: Array<{ card_id: string; row: number; col: number }>;
  }>;
  validation_status: 'VALID' | 'INVALID';
  validation_result?: { valid: boolean; errors?: string[]; warnings?: string[] };
  updated_at: string;
};

type ArenaSnapshotCard = ArenaSnapshotCardDto;
type ArenaDeckSnapshot = ArenaDeckSnapshotDto;
type ArenaMatchView = ArenaMatchViewDto;
type ArenaRecentMatch = ArenaMatchViewDto;

type ArenaReplayEvent = ArenaReplayEventDto;
type ArenaReplay = ArenaReplayPayloadDto;

type ArenaQuickMatch = {
  status: 'queued' | 'matched' | 'cancelled' | 'expired' | 'none';
  queue_ticket_id: string | null;
  match_id: string | null;
  elapsed_sec: number;
  poll_after_sec: number | null;
  resume_available: boolean;
  expires_at?: string | null;
};

type ArenaCupStatus = {
  status: 'queued' | 'matched' | 'cancelled' | 'expired' | 'none';
  queue_ticket_id: string | null;
  cup_id: string | null;
  queued_count: number;
  required_count: number;
  elapsed_sec: number;
  poll_after_sec: number | null;
  resume_available: boolean;
  expires_at?: string | null;
};

type ArenaCupDetail = {
  cup: {
    id: string;
    champion_user_id: string | null;
    participant_count: number;
    bracket?: {
      matches?: Array<{
        stage: string;
        index: number;
        winner_user_id: string;
        player_a?: { user_id: string; deck_name?: string };
        player_b?: { user_id: string; deck_name?: string };
        player_a_round_wins: number;
        player_b_round_wins: number;
        round_count: number;
      }>;
    } | null;
  };
};

type ArenaProfile = {
  season_id: string;
  user_id: string;
  rating: number;
  tier: string;
  rank: number | null;
  wins: number;
  losses: number;
  draws: number;
  sets_played: number;
  ranked_enabled: boolean;
};

type ArenaRankingItem = {
  rank: number;
  user_id: string;
  rating: number;
  rating_points: number;
  tier: string;
  wins: number;
  losses: number;
  draws: number;
};

type ArenaRankings = {
  items: ArenaRankingItem[];
  updated_at: string;
  source: string;
};

type ArenaUserProfile = ArenaProfile & {
  recent_matches: ArenaRecentMatch[];
  win_rate: number;
};

type ArenaSpectatorReplay = {
  match: {
    match_id: string;
    match_type: string;
    round_count: number;
    player_a_round_wins: number;
    player_b_round_wins: number;
    draw_rounds: number;
    created_at: string;
    player_deck?: ArenaDeckSnapshot;
    opponent_deck?: ArenaDeckSnapshot;
  };
  replay: ArenaReplay;
};

type ArenaShopItem = {
  id: number;
  type: 'border' | 'name_effect' | 'emote';
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  font_url: string | null;
  font_family: string | null;
  purchase_limit: number;
  listed_at?: string | null;
  created_at?: string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  limited_total_quantity?: number;
  sold_quantity?: number;
};

export type ArenaSiteTab = 'play' | 'inventory' | 'ranking' | 'style' | 'admin';
type ArenaStyleFilter = 'all' | 'border' | 'name_effect' | 'emote';

const arenaMatchHref = (matchId: string) => `/arena/matches?match_id=${encodeURIComponent(matchId)}`;

type ArenaRoundReveal = {
  roundNo: number;
  stage: 'battle' | 'result';
  roundWinner: 'player' | 'bot' | 'draw';
  completed: boolean;
  matchResult: ArenaMatchView['result'];
};

type ArenaRoundWaitState = {
  roundNo: number;
  deadlineAt: string;
};

type ArenaCosmeticLoadout = {
  user_id: string;
  border_item_id: number | null;
  name_effect_item_id: number | null;
  emote_slot_1_item_id: number | null;
  emote_slot_2_item_id: number | null;
  emote_slot_3_item_id: number | null;
  emote_slot_4_item_id: number | null;
  border_item?: ArenaShopItem | null;
  name_effect_item?: ArenaShopItem | null;
  emote_slot_1_item?: ArenaShopItem | null;
  emote_slot_2_item?: ArenaShopItem | null;
  emote_slot_3_item?: ArenaShopItem | null;
  emote_slot_4_item?: ArenaShopItem | null;
  updated_at: string | null;
};

type ArenaEmoteSlotKey =
  | 'emote_slot_1_item_id'
  | 'emote_slot_2_item_id'
  | 'emote_slot_3_item_id'
  | 'emote_slot_4_item_id';

type ArenaLiveEmote = {
  id: string;
  match_id: string;
  user_id: string;
  username: string;
  item: Pick<ArenaShopItem, 'id' | 'type' | 'name' | 'description' | 'style_json' | 'font_url' | 'font_family'>;
  sent_at: string;
};

const statLabels: Array<[keyof ArenaCard['stats'], string]> = [
  ['hp', '체력'],
  ['attack', '공격'],
  ['defense', '방어'],
  ['speed', '속도'],
  ['focus', '집중']
];

const statDescriptions: Record<keyof ArenaCard['stats'], string> = {
  hp: '라운드에서 버틸 수 있는 기본 생존력입니다.',
  attack: '기본 공격과 물리형 피해의 중심 수치입니다.',
  defense: '받는 피해를 줄이고 전열 유지력을 높입니다.',
  speed: '행동 순서와 공격 템포에 영향을 줍니다.',
  focus: '스킬 발동 흐름과 스킬형 효과 안정성에 영향을 줍니다.'
};

const roleLabels: Record<string, string> = {
  frontline: '전열',
  damage: '공격',
  control: '제어',
  support: '지원',
  tempo: '템포'
};

const roleDescriptions: Record<string, string> = {
  frontline: '앞줄에서 피해를 받아내고 팀의 전투 시간을 벌어주는 역할입니다.',
  damage: '상대 카드를 빠르게 쓰러뜨리는 주 피해 역할입니다.',
  control: '상태 이상과 행동 지연으로 상대의 전투 흐름을 흔드는 역할입니다.',
  support: '회복, 보호, 강화로 아군 카드의 안정성을 높이는 역할입니다.',
  tempo: '행동 순서와 스킬 흐름을 조절해 라운드 주도권을 잡는 역할입니다.'
};

const getStatTooltip = (key: keyof ArenaCard['stats'], label: string, value?: number) => `${label}${typeof value === 'number' ? ` ${value}` : ''}: ${statDescriptions[key]}`;
const getRoleTooltip = (role: string) => `${roleLabels[role] || role}: ${roleDescriptions[role] || '카드의 전투 포지션과 라운드 운영 성향을 나타냅니다.'}`;
const getClassTooltip = (cardClass: ArenaCard['class']) => `${cardClass.name}: ${cardClass.description || getRoleTooltip(cardClass.role)}`;
const getSkillTooltip = (skill: ArenaCard['skills'][number]) => `${skill.name} (${arenaSkillSlotLabels[skill.type as ArenaSkillSlotType] || skill.type}): ${skill.description}`;

type ArenaTagMeta = { label: string; description: string };

const ArenaInfoTooltip: React.FC<{
  label: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, description, children, className }) => (
  <StreamerTooltip
    as="span"
    className={`inline-flex min-w-0 ${className || ''}`.trim()}
    edgeGuard={{ right: 300, bottom: 160 }}
    content={(
      <span className="block max-w-[17rem] text-left">
        <span className="block text-[10px] font-black text-primary">{label}</span>
        <span className="mt-1 block text-[11px] font-bold leading-relaxed text-foreground/85">{description}</span>
      </span>
    )}
  >
    {children}
  </StreamerTooltip>
);

const ArenaClassTooltip: React.FC<{ cardClass: ArenaCard['class']; children: React.ReactNode; className?: string }> = ({ cardClass, children, className }) => (
  <ArenaInfoTooltip label={cardClass.name} description={cardClass.description || getRoleTooltip(cardClass.role)} className={className}>
    {children}
  </ArenaInfoTooltip>
);

const ArenaRoleTooltip: React.FC<{ role: string; children: React.ReactNode; className?: string }> = ({ role, children, className }) => (
  <ArenaInfoTooltip label={roleLabels[role] || role} description={roleDescriptions[role] || '카드의 전투 포지션과 라운드 운영 성향을 나타냅니다.'} className={className}>
    {children}
  </ArenaInfoTooltip>
);

const ArenaStatTooltip: React.FC<{ statKey: keyof ArenaCard['stats']; label: string; value?: number; children: React.ReactNode; className?: string }> = ({ statKey, label, value, children, className }) => (
  <ArenaInfoTooltip label={`${label}${typeof value === 'number' ? ` ${value}` : ''}`} description={statDescriptions[statKey]} className={className}>
    {children}
  </ArenaInfoTooltip>
);

const ArenaSkillTooltip: React.FC<{ skill: ArenaCard['skills'][number]; children: React.ReactNode; className?: string }> = ({ skill, children, className }) => (
  <ArenaInfoTooltip label={`${skill.name} (${arenaSkillSlotLabels[skill.type as ArenaSkillSlotType] || skill.type})`} description={skill.description} className={className}>
    {children}
  </ArenaInfoTooltip>
);

const ArenaSkillList: React.FC<{
  skills?: ArenaCard['skills'];
  compact?: boolean;
  max?: number;
}> = ({ skills = [], compact = false, max = 3 }) => {
  const visibleSkills = skills.slice(0, max);
  if (visibleSkills.length === 0) return null;
  return (
    <div className={compact ? 'mt-1 flex min-w-0 flex-wrap gap-1' : 'mt-3 space-y-1.5'}>
      {visibleSkills.map((skill) => (
        compact ? (
          <ArenaSkillTooltip key={skill.id} skill={skill}>
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/65 px-2 py-0.5 text-[9px] font-black text-primary dark:bg-white/10">
              <span className="shrink-0 text-muted-foreground">{arenaSkillSlotLabels[skill.type as ArenaSkillSlotType] || skill.type}</span>
              <span className="truncate">{skill.name}</span>
            </span>
          </ArenaSkillTooltip>
        ) : (
          <div key={skill.id} className="rounded-2xl bg-secondary/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-black text-foreground">
                <ArenaSkillTooltip skill={skill}>
                  <span>{skill.name}</span>
                </ArenaSkillTooltip>
              </p>
              <ArenaSkillTooltip skill={skill}>
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[8px] font-black text-muted-foreground dark:bg-white/10">
                  {arenaSkillSlotLabels[skill.type as ArenaSkillSlotType] || skill.type}
                </span>
              </ArenaSkillTooltip>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[10px] font-bold text-muted-foreground">{skill.description}</p>
          </div>
        )
      ))}
    </div>
  );
};

const arenaTagMeta: Record<string, ArenaTagMeta> = {
  guardian: { label: '수호', description: '보호막과 아군 보호 효율을 높이는 방어 태그입니다.' },
  frontline: { label: '전열', description: '앞줄 생존력과 집중 공격을 버티는 힘을 보강합니다.' },
  order: { label: '질서', description: '전열 안정성과 상태 저항 중심의 정돈된 운영 태그입니다.' },
  command: { label: '지휘', description: '같은 대상을 함께 압박하는 집중 공격 운영에 어울립니다.' },
  duel: { label: '결투', description: '단일 대상 교전과 지속 압박에 강한 태그입니다.' },
  focus: { label: '집중', description: '스킬 흐름, 표식 대상 피해, 명중 안정성을 보강합니다.' },
  blade: { label: '검술', description: '기본 공격과 근접 교전 성능을 높이는 공격 태그입니다.' },
  rage: { label: '격노', description: '체력이 낮아질수록 공격적으로 반격하는 성향입니다.' },
  hunt: { label: '사냥', description: '약해진 적을 추적하고 마무리하는 데 유리합니다.' },
  precision: { label: '정밀', description: '치명타와 정확한 단일 타격 성능을 높입니다.' },
  backline: { label: '후열', description: '뒤쪽 배치에서 안정적으로 피해를 누적하는 태그입니다.' },
  speed: { label: '속도', description: '행동 순서와 공격 템포를 앞당깁니다.' },
  arcane: { label: '비전', description: '에너지와 마법형 스킬 운용을 안정화합니다.' },
  flame: { label: '화염', description: '지속 피해와 광역 압박에 어울리는 공격 태그입니다.' },
  frost: { label: '서리', description: '둔화와 제한적 행동 방해로 상대 템포를 늦춥니다.' },
  storm: { label: '폭풍', description: '무작위 피해와 연쇄 타격으로 변수를 만듭니다.' },
  curse: { label: '저주', description: '취약, 약화, 지속 압박으로 상대 강점을 깎습니다.' },
  poison: { label: '독', description: '지속 피해와 회복 견제를 담당합니다.' },
  control: { label: '제어', description: '상태 이상과 행동 흐름 방해에 특화된 태그입니다.' },
  healing: { label: '치유', description: '회복량과 생존 보조 효율을 높입니다.' },
  light: { label: '빛', description: '보호, 정화, 상태 저항을 돕는 안정형 태그입니다.' },
  cleanse: { label: '정화', description: '디버프 완화와 상태 이상 대응에 유리합니다.' },
  support_link: { label: '연결', description: '인접 아군 보호와 팀 보조 효과에 어울립니다.' },
  song: { label: '노래', description: '버프와 에너지 흐름을 부드럽게 보조합니다.' },
  machine: { label: '기계', description: '주기적 강화와 보호막 파쇄에 어울리는 태그입니다.' },
  trap: { label: '함정', description: '시간차 피해와 전장 방해로 상대 진형을 흔듭니다.' },
  shadow: { label: '그림자', description: '첫 공격, 회피, 후열 압박에 어울리는 태그입니다.' },
  trick: { label: '속임수', description: '회피와 교란으로 예측하기 어려운 흐름을 만듭니다.' },
  space: { label: '공간', description: '위치 이동과 배치 변수를 활용하는 태그입니다.' },
  stone: { label: '석갑', description: '방어와 장기전 안정성을 보강합니다.' },
  shield: { label: '보호막', description: '피해를 흡수하는 보호막 효과와 관련된 태그입니다.' },
  guard: { label: '수비', description: '받는 피해를 줄이고 전열을 안정화합니다.' },
  redirect: { label: '유도', description: '공격 대상을 전열이나 자신 쪽으로 끌어오는 효과입니다.' },
  survive: { label: '생존', description: '위기 상황에서 버티거나 회복하는 효과입니다.' },
  heal: { label: '회복', description: '체력을 회복해 라운드 지속력을 높입니다.' },
  late: { label: '후반', description: '라운드가 길어질수록 효율이 좋아지는 성향입니다.' },
  burst: { label: '폭발', description: '짧은 시간에 높은 피해를 몰아치는 태그입니다.' },
  single: { label: '단일', description: '한 대상에게 피해나 효과를 집중합니다.' },
  execute: { label: '처형', description: '체력이 낮은 적을 마무리하는 효과입니다.' },
  tempo: { label: '템포', description: '행동 순서와 전투 흐름을 유리하게 조정합니다.' },
  chain: { label: '연계', description: '처치나 발동 이후 다음 행동으로 이어지는 효과입니다.' },
  magic: { label: '마법', description: '집중 기반 스킬 피해와 제어 효과에 관련됩니다.' },
  area: { label: '광역', description: '여러 대상에게 피해나 효과를 나누어 적용합니다.' },
  scale: { label: '성장', description: '조건을 만족할수록 성능이 점진적으로 좋아집니다.' },
  delay: { label: '지연', description: '짧은 준비 시간 뒤 강한 효과가 발동됩니다.' },
  resource: { label: '자원', description: '집중, 에너지, 쿨다운 흐름을 보정합니다.' },
  ranged: { label: '원거리', description: '후열에서 안정적으로 공격하는 성향입니다.' },
  mark: { label: '표식', description: '특정 대상을 지정해 후속 피해나 집중 공격을 돕습니다.' },
  multi: { label: '다중', description: '여러 대상이나 여러 타격으로 효과를 나눕니다.' },
  crit: { label: '치명', description: '치명타 확률이나 결정력을 높입니다.' },
  evade: { label: '회피', description: '피해를 줄이거나 피하면서 반격 기회를 만듭니다.' },
  decoy: { label: '미끼', description: '첫 피격이나 타겟팅을 흔드는 방어적 교란 효과입니다.' },
  disrupt: { label: '교란', description: '상대 행동 순서와 스킬 타이밍을 방해합니다.' },
  support: { label: '지원', description: '아군 회복, 보호, 버프와 관련된 태그입니다.' },
  buff: { label: '강화', description: '아군 능력치를 잠시 끌어올립니다.' },
  team: { label: '팀', description: '아군 여러 명에게 영향을 주는 효과입니다.' },
  aura: { label: '오라', description: '주변 또는 후열 아군에게 지속 보조를 제공합니다.' },
  break: { label: '파쇄', description: '보호막과 방어 태세를 깨는 데 강합니다.' },
  armor: { label: '방어구', description: '방어력 높은 대상이나 보호 효과와 상호작용합니다.' },
  counter: { label: '역습', description: '상대 공격을 받아낸 뒤 반격하는 성향입니다.' },
  stun: { label: '기절', description: '짧게 행동을 늦추거나 멈추는 제어 효과입니다.' },
  debuff: { label: '약화', description: '상대 능력치나 방어 효율을 낮춥니다.' },
  cooldown: { label: '쿨다운', description: '스킬 재사용 흐름과 행동 주기를 조정합니다.' },
  adapt: { label: '적응', description: '라운드 흐름에 맞춰 보정이 바뀌는 태그입니다.' },
  anchor: { label: '고정', description: '팀의 중심을 잡고 라운드 플랜을 안정화합니다.' },
  carry: { label: '캐리', description: '주요 피해원으로 팀 전투를 이끄는 성향입니다.' },
  combo: { label: '콤보', description: '다른 카드나 효과와 맞물릴 때 가치가 커집니다.' },
  cute: { label: '큐트', description: '아레나 카드 콘셉트를 꾸미는 감성 태그입니다.' },
  defense: { label: '방어', description: '피해 감소와 생존력 중심의 태그입니다.' },
  finisher: { label: '마무리', description: '후반 결정력과 처치 관여에 어울립니다.' }
};

const getArenaTagMeta = (tag: string): ArenaTagMeta => arenaTagMeta[tag] || {
  label: tag.replace(/_/g, ' '),
  description: '이 태그는 카드의 전투 성향과 조합 콘셉트를 구분하는 데 사용됩니다.'
};

const ArenaTagBadge: React.FC<{ tag: string; selected?: boolean; asButton?: boolean; onClick?: () => void }> = ({ tag, selected = false, asButton = false, onClick }) => {
  const meta = getArenaTagMeta(tag);
  const tooltip = (
    <div className="max-w-[16rem] text-left">
      <p className="text-[10px] font-black text-primary">#{meta.label}</p>
      <p className="mt-1 text-[11px] font-bold leading-relaxed text-foreground/85">{meta.description}</p>
    </div>
  );
  const className = asButton
    ? `rounded-full px-2.5 py-1 text-[10px] font-black transition ${selected ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-300 dark:bg-rose-300/15 dark:text-rose-100' : 'bg-card text-muted-foreground hover:bg-secondary'}`
    : 'rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-black text-primary dark:bg-white/10';

  return (
    <StreamerTooltip content={tooltip} className="inline-flex" edgeGuard={{ right: 280, bottom: 120 }}>
      {asButton ? (
        <button type="button" onClick={onClick} className={className} aria-pressed={selected} aria-label={`${meta.label}: ${meta.description}`}>
          #{meta.label}
        </button>
      ) : (
        <span className={className}>
          #{meta.label}
        </span>
      )}
    </StreamerTooltip>
  );
};

const cupStageLabels: Record<string, string> = {
  quarterfinal: '8강',
  semifinal: '4강',
  final: '결승'
};

const ARENA_ROUND_NOS = [1, 2, 3, 4, 5] as const;
const ARENA_DECK_CARD_LIMIT = 10;
const ARENA_PLAY_CARD_PREVIEW_LIMIT = 12;

const pickRandomArenaCards = (items: ArenaCard[], limit = ARENA_PLAY_CARD_PREVIEW_LIMIT) => {
  if (items.length <= limit) return items;
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, limit)
    .map(({ item }) => item);
};

const createArenaEventSource = (path: string) => {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null;
  return new EventSource(`${API_BASE_URL}${path}`, { withCredentials: true });
};

const normalizeArenaProgressStatus = (status?: unknown) => String(status || '').trim().toLowerCase();
const isArenaMatchCompleted = (match?: Pick<ArenaMatchView, 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) => {
  const status = normalizeArenaProgressStatus(match?.summary?.progress_status);
  if (status === 'completed') return true;
  if (status === 'in_progress') return false;
  return Number(match?.player_a_round_wins || 0) >= 3 || Number(match?.player_b_round_wins || 0) >= 3 || Number(match?.round_count || 0) >= 5;
};
const isArenaMatchInProgress = (match?: Pick<ArenaMatchView, 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) =>
  Boolean(match) && !isArenaMatchCompleted(match);
const getArenaMatchResultLabel = (match?: Pick<ArenaMatchView, 'result' | 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) => {
  if (!match || isArenaMatchInProgress(match)) return '진행 중';
  return match.result === 'win' ? '승리' : match.result === 'loss' ? '패배' : match.result === 'draw' ? '무승부' : '결과 없음';
};

const ARENA_ROUND_SELECTION_TIMEOUT_MS = 60_000;
const tacticOptions = [
  ['balanced', '균형'],
  ['aggressive', '공격'],
  ['guard', '수비'],
  ['tempo', '템포'],
  ['counter', '역습'],
  ['finisher', '마무리']
] as const;

const tacticDescriptions: Record<string, string> = {
  balanced: '위험을 낮추고 전열과 후열의 손실을 고르게 관리합니다.',
  aggressive: '초반 피해량을 끌어올려 상대 핵심 카드를 빠르게 압박합니다.',
  guard: '생존과 보호를 우선해 다음 라운드 반전을 노립니다.',
  tempo: '속도와 스킬 순서를 앞당겨 전투 흐름을 먼저 잡습니다.',
  counter: '상대의 강한 카드를 받아친 뒤 후반 교환 이득을 노립니다.',
  finisher: '마지막 라운드에서 결정력을 높여 승부를 마무리합니다.'
};

const focusOptions = [
  ['frontline_first', '전열 우선'],
  ['backline_first', '후열 우선'],
  ['lowest_hp', '약한 적'],
  ['highest_attack', '고화력']
] as const;

const focusDescriptions: Record<string, string> = {
  frontline_first: '앞줄을 먼저 정리해 후열 카드가 안정적으로 움직이게 합니다.',
  backline_first: '상대 핵심 딜러와 지원 카드를 빠르게 흔듭니다.',
  lowest_hp: '마무리 가능한 대상을 우선해 수적 우위를 만듭니다.',
  highest_attack: '가장 위협적인 공격 카드를 먼저 견제합니다.'
};

const roleToneClass: Record<string, string> = {
  frontline: 'from-rose-100 via-red-50 to-white dark:from-rose-400/18 dark:via-red-400/10 dark:to-white/5',
  damage: 'from-red-100 via-rose-100 to-white dark:from-red-400/18 dark:via-rose-400/12 dark:to-white/5',
  control: 'from-pink-100 via-rose-100 to-white dark:from-pink-400/16 dark:via-rose-400/12 dark:to-white/5',
  support: 'from-rose-100 via-pink-50 to-white dark:from-rose-400/16 dark:via-pink-400/10 dark:to-white/5',
  tempo: 'from-red-50 via-rose-100 to-white dark:from-red-400/12 dark:via-rose-400/14 dark:to-white/5'
};

const formatSecondsRange = (range?: { min: number; max: number }) => {
  if (!range) return '7~12분';
  return `${Math.round(range.min / 60)}~${Math.round(range.max / 60)}분`;
};

const formatQueueDuration = (seconds?: number | null) => {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes <= 0) return `${remain}초`;
  return `${minutes}분 ${remain.toString().padStart(2, '0')}초`;
};

const getQuickQueueEstimate = (seconds?: number | null) => {
  const elapsed = Number(seconds || 0);
  if (elapsed < 15) return '보통 수 초 안에 상대를 찾고 있습니다.';
  if (elapsed < 45) return 'MMR 범위를 넓히며 가까운 상대를 찾는 중입니다.';
  if (elapsed < 90) return '현재 동접 대기 풀이 작아 조금 더 걸릴 수 있습니다.';
  return '대기가 길어지면 취소 후 봇 연습전으로 흐름을 확인할 수 있습니다.';
};

const getCupQueueEstimate = (queued?: number | null, required?: number | null) => {
  const current = Math.max(0, Number(queued || 0));
  const target = Math.max(1, Number(required || 8));
  const left = Math.max(0, target - current);
  if (left <= 0) return '참가자가 모두 모였습니다. 결과를 정리하는 중입니다.';
  if (left <= 2) return `${left}명만 더 오면 바로 컵이 시작됩니다.`;
  if (current >= Math.ceil(target / 2)) return '절반 이상 모였습니다. 참가자 풀이 유지되면 곧 시작됩니다.';
  return '8인 컵은 참가자가 모일 때 시작되므로 빠른대전보다 오래 걸릴 수 있습니다.';
};

const showArenaInactiveNotification = async (payload: { tag: string; title: string; body: string; url: string }) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const options: NotificationOptions & { renotify?: boolean; data?: unknown } = {
    body: payload.body,
    icon: '/arena-icon.png',
    badge: '/badge.png',
    tag: payload.tag,
    renotify: true,
    data: { url: payload.url }
  };

  try {
    const registration = 'serviceWorker' in navigator
      ? await Promise.race<ServiceWorkerRegistration | undefined>([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 700))
      ])
      : undefined;

    if (registration?.showNotification) {
      await registration.showNotification(payload.title, options);
      return;
    }

    const notification = new Notification(payload.title, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = payload.url;
      notification.close();
    };
  } catch (err) {
    console.warn('[ArenaTab] inactive match notification failed:', err);
  }
};

const arenaSkillSlotTypes = ['active', 'passive', 'ultimate'] as const;
type ArenaSkillSlotType = typeof arenaSkillSlotTypes[number];

const arenaSkillSlotLabels: Record<ArenaSkillSlotType, string> = {
  active: '액티브',
  passive: '패시브',
  ultimate: '궁극기'
};

const pickDefaultSkillIds = (skills: ArenaCard['skills'] = []) => arenaSkillSlotTypes
  .map((type) => skills.find((skill) => skill.type === type)?.id)
  .filter((id): id is string => Boolean(id));

const formatArenaTier = (tier?: string | null) => {
  const normalized = String(tier || 'BRONZE').toUpperCase();
  return ({
    MASTER: '마스터',
    DIAMOND: '다이아',
    PLATINUM: '플래티넘',
    GOLD: '골드',
    SILVER: '실버',
    BRONZE: '브론즈'
  } as Record<string, string>)[normalized] || tier || '브론즈';
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const parseOptionalTime = (value?: string | null) => {
  if (!value) return NaN;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? NaN : date.getTime();
};

const getArenaShopSaleState = (item: ArenaShopItem, now = Date.now()) => {
  const startMs = parseOptionalTime(item.sale_start_at);
  const endMs = parseOptionalTime(item.sale_end_at);
  const total = Math.max(0, Number(item.limited_total_quantity || 0));
  const sold = Math.max(0, Number(item.sold_quantity || 0));
  const isLimited = Number.isFinite(startMs) || Number.isFinite(endMs) || total > 0;
  const notStarted = Number.isFinite(startMs) && now < startMs;
  const ended = Number.isFinite(endMs) && now > endMs;
  const totalSoldOut = total > 0 && sold >= total;
  return { isLimited, notStarted, ended, total, sold, totalSoldOut };
};

const arenaEmoteSlots: Array<{
  key: ArenaEmoteSlotKey;
  itemKey: keyof ArenaCosmeticLoadout;
  label: string;
  direction: 'top' | 'right' | 'bottom' | 'left';
  slot: number;
}> = [
  { key: 'emote_slot_1_item_id', itemKey: 'emote_slot_1_item', label: '상', direction: 'top', slot: 1 },
  { key: 'emote_slot_2_item_id', itemKey: 'emote_slot_2_item', label: '우', direction: 'right', slot: 2 },
  { key: 'emote_slot_3_item_id', itemKey: 'emote_slot_3_item', label: '하', direction: 'bottom', slot: 3 },
  { key: 'emote_slot_4_item_id', itemKey: 'emote_slot_4_item', label: '좌', direction: 'left', slot: 4 }
];

const getArenaEmoteItems = (loadout: ArenaCosmeticLoadout | null) =>
  arenaEmoteSlots
    .map((slot) => {
      const item = loadout?.[slot.itemKey] as ArenaShopItem | null | undefined;
      return item?.type === 'emote' ? { ...slot, item } : null;
    })
    .filter((item): item is { key: ArenaEmoteSlotKey; itemKey: keyof ArenaCosmeticLoadout; label: string; direction: 'top' | 'right' | 'bottom' | 'left'; slot: number; item: ArenaShopItem } => Boolean(item));

const getArenaEmoteVisual = (item?: Pick<ArenaShopItem, 'name' | 'style_json'> | null) => {
  let parsed: Record<string, any> = {};
  if (item?.style_json) {
    try { parsed = JSON.parse(item.style_json); } catch { parsed = {}; }
  }
  const imageUrl = typeof parsed.image_url === 'string' ? parsed.image_url : '';
  const emoji = typeof parsed.emoji === 'string' ? parsed.emoji : '';
  const className = typeof parsed.class === 'string' ? parsed.class : '';
  const style = parseStyle(item?.style_json || null) || {};
  delete (style as any).image_url;
  delete (style as any).emoji;
  delete (style as any).class;
  delete (style as any).css;
  return { imageUrl, emoji, className, style };
};

const ArenaEmoteBadge: React.FC<{ item?: Pick<ArenaShopItem, 'name' | 'style_json'> | null; size?: 'sm' | 'md' | 'lg' }> = ({ item, size = 'md' }) => {
  React.useEffect(() => {
    ensureCosmeticCss(item || null);
  }, [item]);
  const visual = getArenaEmoteVisual(item);
  const sizeClass = size === 'lg' ? 'h-20 w-20 text-4xl' : size === 'sm' ? 'h-10 w-10 text-xl' : 'h-14 w-14 text-2xl';
  const imageClass = size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  return (
    <div className={`arena-emote-badge ${visual.className} ${sizeClass}`} style={visual.style} aria-label={item?.name || '이모트'}>
      {visual.imageUrl ? (
        <img src={visual.imageUrl} alt={item?.name || 'emote'} className={`${imageClass} object-contain`} loading="lazy" />
      ) : (
        <span>{visual.emoji || item?.name?.slice(0, 1) || '♪'}</span>
      )}
    </div>
  );
};

const buildArenaRealtimeSocketUrl = () => {
  if (typeof window === 'undefined') return '';
  const explicit = process.env.NEXT_PUBLIC_ARENA_WS_URL;
  if (explicit) return explicit;
  if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/arena/realtime';
    url.search = '';
    return url.toString();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/arena/realtime`;
};

const buildEditableRoundPlans = (deck: ArenaDeck): ArenaDeck['round_plans'] => {
  const existing = Array.isArray(deck.round_plans) ? deck.round_plans : [];
  const baseCards = deck.cards.slice(0, 6);
  return ARENA_ROUND_NOS.map((roundNo) => {
    const existingPlan = existing.find((plan) => plan.round_no === roundNo);
    if (existingPlan?.slots?.length) return existingPlan;
    const slots = baseCards.map((card, index) => {
      const offsetByRound: Record<number, number> = { 1: 0, 2: 1, 3: 3, 4: 2, 5: 4 };
      const shifted = (index + (offsetByRound[roundNo] || 0)) % 6;
      return {
        card_id: card.card_id,
        row: shifted < 3 ? 1 : 0,
        col: shifted % 3
      };
    });
    return {
      round_no: roundNo,
      formation_id: roundNo === 1 ? 'default-2x4' : `round-${roundNo}-2x4`,
      tactic_style: roundNo === 5 ? 'finisher' : roundNo === 4 ? 'hold' : roundNo === 3 ? 'tempo' : roundNo === 2 ? 'counter' : 'balanced',
      focus_rule: 'frontline_first',
      slots
    };
  });
};

const StatBar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-[10px] font-black text-muted-foreground">
      <span>{label}</span>
      <span>{value}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-white/65 dark:bg-white/10">
      <div
        className="arena-stat-fill h-full rounded-full bg-gradient-to-r from-rose-300 via-red-300 to-pink-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  </div>
);

const ArenaStateNotice: React.FC<{
  variant?: 'empty' | 'error' | 'loading';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}> = ({ variant = 'empty', title, description, actionLabel, onAction, disabled }) => {
  const Icon = variant === 'error' ? AlertCircle : variant === 'loading' ? RefreshCw : Layers3;
  return (
    <div className={`arena-state-notice arena-empty-state mt-4 rounded-3xl border border-dashed p-4 text-center ${variant === 'error' ? 'arena-error-state border-rose-200 bg-rose-50/70 dark:border-rose-300/20 dark:bg-rose-300/10' : 'border-border bg-secondary/32'}`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/78 text-primary shadow-sm dark:bg-white/10">
        <Icon className={`h-6 w-6 ${variant === 'loading' ? 'animate-spin' : ''}`} />
      </div>
      <h3 className="mt-3 text-sm font-black text-foreground">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs font-bold leading-relaxed text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="cute-wiggle-hover mt-3 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${disabled ? 'animate-spin' : ''}`} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
};

const ArenaCardSkeletonGrid: React.FC = () => (
  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="아레나 카드 로딩 중">
    {Array.from({ length: 4 }).map((_, index) => (
      <div key={index} className="arena-skeleton-card rounded-3xl border border-white/70 bg-white/66 p-3 shadow-sm dark:border-white/10 dark:bg-white/8">
        <div className="arena-skeleton-shimmer h-36 rounded-[1.35rem] bg-secondary/70" />
        <div className="mt-3 h-4 w-2/3 rounded-full bg-secondary/70" />
        <div className="mt-2 h-3 w-1/2 rounded-full bg-secondary/50" />
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {Array.from({ length: 5 }).map((__, statIndex) => (
            <div key={statIndex} className="h-10 rounded-2xl bg-secondary/55" />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const ArenaListSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="mt-4 space-y-2" aria-label="목록 로딩 중">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="arena-skeleton-shimmer h-12 rounded-2xl bg-secondary/70" />
    ))}
  </div>
);

const formatReplayTime = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}초`;

const getOpponentDeckSnapshot = (summary?: ArenaMatchView['summary']) =>
  summary?.opponent_deck || summary?.bot_deck;

const getReplayActorLabel = (id: string | undefined, match: ArenaMatchView) => {
  if (!id) return '';
  const [, cardId] = id.split(':');
  const opponentDeck = getOpponentDeckSnapshot(match.summary);
  const card = [...(match.summary?.player_deck?.cards || []), ...(opponentDeck?.cards || [])]
    .find((item) => item.card_id === cardId);
  if (card) return card.name;
  return id.startsWith('player:') ? '플레이어 카드' : id.startsWith('bot:') ? '봇 카드' : id;
};

const getReplayEventLabel = (event: ArenaReplayEvent, match: ArenaMatchView) => {
  if (event.message) return event.message;
  const actor = getReplayActorLabel(event.actor, match);
  const target = getReplayActorLabel(event.targets?.[0], match);
  if (event.type === 'BASIC_ATTACK') return `${actor} 기본 공격`;
  if (event.type === 'DAMAGE') return `${actor} -> ${target} ${event.value || 0} 피해`;
  if (event.type === 'HEAL') return `${actor} -> ${target} ${event.value || 0} 회복`;
  if (event.type === 'SHIELD_GAIN') return `${actor} -> ${target} 보호막 ${event.value || 0}`;
  if (event.type === 'SKILL_CAST') return `${actor} 스킬 사용`;
  if (event.type === 'DEATH') return `${actor} 전투 불능`;
  return event.type;
};

const getRoundCards = (deck: ArenaDeckSnapshot | undefined, roundNo: number): ArenaSnapshotCard[] => {
  if (!deck) return [];
  const plan = deck.round_plans.find((item) => item.round_no === roundNo) || deck.round_plans[0];
  const cardById = new Map(deck.cards.map((card) => [card.card_id, card]));
  const planned = (plan?.slots || [])
    .slice(0, 6)
    .map((slot) => cardById.get(slot.card_id))
    .filter((card): card is ArenaSnapshotCard => Boolean(card));
  return planned.length > 0 ? planned : deck.cards.slice(0, 6);
};

const getDeckDiagnostics = (deck: ArenaDeck, cardById: Map<string, ArenaCard>) => {
  const deckCards = deck.cards
    .map((card) => cardById.get(card.card_id))
    .filter((card): card is ArenaCard => Boolean(card));
  const roleCounts = deckCards.reduce<Record<string, number>>((acc, card) => {
    const role = card.class.role || 'unknown';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const statTotals = deckCards.reduce<Record<keyof ArenaCard['stats'], number>>((acc, card) => {
    statLabels.forEach(([key]) => {
      acc[key] += Number(card.stats[key] || 0);
    });
    return acc;
  }, { hp: 0, attack: 0, defense: 0, speed: 0, focus: 0 });
  const dominantStat = statLabels
    .map(([key, label]) => ({ key, label, value: statTotals[key] }))
    .sort((a, b) => b.value - a.value)[0];
  const warnings = [
    roleCounts.frontline ? null : '전열 역할이 없어 초반 집중 공격에 약할 수 있습니다.',
    roleCounts.damage ? null : '공격 역할이 부족해 장기전으로 끌릴 수 있습니다.',
    roleCounts.support ? null : '지원 역할이 없어 회복/보호 변수가 적습니다.',
    deck.round_plans.length >= 5 ? null : '5라운드 플랜이 모두 저장되지 않았습니다.',
    deck.validation_status === 'VALID' ? null : '현재 규칙에 맞게 덱을 조금 더 다듬어야 합니다.'
  ].filter((item): item is string => Boolean(item));

  const strengths = [
    roleCounts.frontline && roleCounts.damage ? '전열과 공격 역할이 함께 있어 기본 교전 안정성이 좋습니다.' : null,
    roleCounts.control ? '제어 카드가 있어 상대 핵심 행동을 끊는 변수가 있습니다.' : null,
    roleCounts.support ? '지원 카드가 있어 후반 라운드 유지력이 있습니다.' : null,
    dominantStat ? `${dominantStat.label} 중심으로 색깔이 분명한 덱입니다.` : null
  ].filter((item): item is string => Boolean(item));

  return {
    deckCards,
    roleCounts,
    statTotals,
    dominantStat,
    warnings,
    strengths,
    readiness: Math.min(100, Math.round(
      (deck.validation_status === 'VALID' ? 36 : 14)
      + Math.min(deck.cards.length, ARENA_DECK_CARD_LIMIT) * 3
      + Math.min(deck.round_plans.length, 5) * 5
      + Math.min(Object.keys(roleCounts).length, 4) * 3
    ))
  };
};

const getArenaMatchHighlights = (match: ArenaMatchView | null, replay: ArenaReplay | null) => {
  if (!match) return null;
  const roundResults = match.summary?.round_results || [];
  const playerDamage = roundResults.reduce((total, round) => total + Number(round.player_total_damage || 0), 0);
  const opponentDamage = roundResults.reduce((total, round) => total + Number(round.bot_total_damage || 0), 0);
  const decisiveRound = [...roundResults].reverse().find((round) => round.winner_side !== 'draw') || roundResults[roundResults.length - 1];
  const actorScores = new Map<string, { label: string; damage: number; heals: number; skillCasts: number; events: number }>();

  const getEntry = (actorId: string | undefined) => {
    if (!actorId) return null;
    const existing = actorScores.get(actorId);
    if (existing) return existing;
    const created = { label: getReplayActorLabel(actorId, match), damage: 0, heals: 0, skillCasts: 0, events: 0 };
    actorScores.set(actorId, created);
    return created;
  };

  for (const round of replay?.rounds || []) {
    for (const event of round.events || []) {
      const entry = getEntry(event.actor);
      if (!entry) continue;
      entry.events += 1;
      if (event.type === 'DAMAGE') entry.damage += Number(event.value || 0);
      if (event.type === 'HEAL') entry.heals += Number(event.value || 0);
      if (event.type === 'SKILL_CAST') entry.skillCasts += 1;
    }
  }

  const mvp = Array.from(actorScores.values()).sort((a, b) =>
    (b.damage + b.heals * 0.8 + b.skillCasts * 12 + b.events) - (a.damage + a.heals * 0.8 + a.skillCasts * 12 + a.events)
  )[0];
  const skillLeader = Array.from(actorScores.values()).sort((a, b) => b.skillCasts - a.skillCasts || b.damage - a.damage)[0];

  return {
    playerDamage,
    opponentDamage,
    decisiveRound,
    mvp,
    skillLeader,
    totalEvents: (replay?.rounds || []).reduce((total, round) => total + (round.events?.length || 0), 0)
  };
};

const ReplayCardTile: React.FC<{ card: ArenaSnapshotCard; side: 'player' | 'bot' }> = ({ card, side }) => (
  <div className={`min-w-0 rounded-2xl border p-2 ${side === 'player' ? 'border-rose-200 bg-rose-50/80 dark:border-rose-300/20 dark:bg-rose-300/10' : 'border-red-200 bg-red-50/80 dark:border-red-300/20 dark:bg-red-300/10'}`}>
    <div className="flex items-center gap-2">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-white/70 dark:bg-white/10">
        {card.image_url ? <img src={card.image_url} alt={card.name} className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-black text-foreground">{card.name}</p>
        <p className="truncate text-[10px] font-bold text-muted-foreground">{card.class_name}</p>
      </div>
    </div>
  </div>
);

const DeckDiagnosticPanel: React.FC<{ deck: ArenaDeck; cardById: Map<string, ArenaCard> }> = ({ deck, cardById }) => {
  const diagnostics = React.useMemo(() => getDeckDiagnostics(deck, cardById), [deck, cardById]);
  return (
    <div className="arena-deck-diagnostic rounded-3xl border border-rose-200/70 bg-rose-50/60 p-3 dark:border-rose-300/20 dark:bg-rose-300/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-rose-700 dark:text-rose-100">덱 진단</p>
          <p className="mt-1 text-sm font-black text-foreground">{diagnostics.dominantStat?.label || '균형'} 중심 · 준비도 {diagnostics.readiness}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${diagnostics.warnings.length === 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-300/15 dark:text-rose-100' : 'bg-red-100 text-red-700 dark:bg-red-300/15 dark:text-red-100'}`}>
          {diagnostics.warnings.length === 0 ? '안정' : `${diagnostics.warnings.length}개 점검`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {statLabels.map(([key, label]) => {
          const max = Math.max(...statLabels.map(([statKey]) => diagnostics.statTotals[statKey]), 1);
          const value = diagnostics.statTotals[key];
          return (
            <div key={key} className="rounded-2xl bg-white/70 px-2 py-2 text-center dark:bg-white/10">
              <p className="text-[9px] font-black text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-xs font-black text-foreground">{value}</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary/70">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(8, Math.round((value / max) * 100))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(diagnostics.strengths.length ? diagnostics.strengths.slice(0, 2) : ['카드 역할을 더 채우면 덱 색깔이 선명해집니다.']).map((item) => (
          <div key={item} className="rounded-2xl bg-white/70 px-3 py-2 text-[10px] font-bold leading-relaxed text-foreground dark:bg-white/10">
            {item}
          </div>
        ))}
        {diagnostics.warnings.slice(0, 2).map((item) => (
          <div key={item} className="rounded-2xl border border-red-200 bg-red-50/80 px-3 py-2 text-[10px] font-bold leading-relaxed text-red-800 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

const ArenaMatchHighlightsPanel: React.FC<{ match: ArenaMatchView; replay: ArenaReplay | null }> = ({ match, replay }) => {
  const highlights = React.useMemo(() => getArenaMatchHighlights(match, replay), [match, replay]);
  if (!highlights) return null;
  const resultLabel = getArenaMatchResultLabel(match);
  return (
    <div className="arena-highlight-panel rounded-3xl border border-white/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-muted-foreground">매치 하이라이트</p>
          <h3 className="mt-1 text-base font-black text-foreground">{resultLabel} · {match.player_a_round_wins}:{match.player_b_round_wins}</h3>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">
          {highlights.totalEvents.toLocaleString()} 이벤트
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['최고 활약', highlights.mvp?.label || '집계 대기', highlights.mvp ? `${highlights.mvp.damage} 피해 · 스킬 ${highlights.mvp.skillCasts}` : '기록 없음'],
          ['결정 라운드', highlights.decisiveRound ? `${highlights.decisiveRound.round_no}R` : '-',
            highlights.decisiveRound ? `${highlights.decisiveRound.winner_side === 'player' ? '플레이어' : highlights.decisiveRound.winner_side === 'bot' ? '상대' : '무승부'} 우세` : '라운드 정보 없음'],
          ['피해 교환', `${highlights.playerDamage} / ${highlights.opponentDamage}`, '플레이어 / 상대'],
          ['스킬 활약', highlights.skillLeader?.label || '집계 대기', highlights.skillLeader ? `${highlights.skillLeader.skillCasts}회 사용` : '기록 없음']
        ].map(([label, value, detail]) => (
          <div key={label} className="arena-status-row rounded-2xl border border-transparent bg-secondary/52 px-3 py-2">
            <p className="text-[10px] font-black text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-xs font-black text-foreground">{value}</p>
            <p className="mt-0.5 truncate text-[10px] font-bold text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ArenaProfileCardModal: React.FC<{
  profile: ArenaUserProfile;
  onClose: () => void;
}> = ({ profile, onClose }) => {
  const decided = profile.wins + profile.losses;
  const winRate = decided > 0 ? profile.win_rate : 0;
  const tierTone = profile.tier === 'DIAMOND' || profile.tier === 'MASTER'
    ? 'from-rose-200 via-red-100 to-pink-100 dark:from-rose-400/20 dark:via-red-400/16 dark:to-pink-400/14'
    : profile.tier === 'GOLD'
      ? 'from-red-100 via-rose-100 to-white dark:from-red-400/16 dark:via-rose-400/12 dark:to-white/5'
      : 'from-rose-100 via-red-50 to-white dark:from-rose-400/15 dark:via-red-400/10 dark:to-white/5';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/48 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="arena-profile-card-modal relative w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/70 bg-card shadow-2xl dark:border-white/10" onClick={(event) => event.stopPropagation()}>
        <div className={`relative bg-gradient-to-br ${tierTone} p-5`}>
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/40 blur-2xl dark:bg-white/10" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-primary">ARENA LICENSE</p>
              <h2 className="mt-1 truncate text-2xl font-black text-foreground">{profile.user_id}</h2>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {profile.rank ? `랭킹 ${profile.rank}위` : '랭킹 집계 대기'} · {profile.sets_played.toLocaleString()}전
              </p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-sm font-black text-foreground shadow-sm dark:bg-white/10">
              ×
            </button>
          </div>

          <div className="relative mt-5 grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <p className="text-[10px] font-black text-muted-foreground">현재 티어</p>
              <p className="mt-1 text-4xl font-black text-foreground">{profile.tier}</p>
            </div>
            <div className="rounded-[1.35rem] bg-white/75 px-4 py-3 text-right shadow-sm dark:bg-white/10">
              <p className="text-[10px] font-black text-muted-foreground">MMR</p>
              <p className="text-2xl font-black text-primary">{profile.rating.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5">
          <div className="grid grid-cols-4 gap-2">
            {[
              ['승', profile.wins.toLocaleString()],
              ['패', profile.losses.toLocaleString()],
              ['무', profile.draws.toLocaleString()],
              ['승률', decided > 0 ? `${winRate}%` : '-']
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-secondary/60 px-3 py-2 text-center">
                <p className="text-[9px] font-black text-muted-foreground">{label}</p>
                <p className="mt-1 text-sm font-black text-foreground">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-border bg-secondary/28 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black text-foreground">승률 흐름</p>
              <span className="text-[10px] font-black text-muted-foreground">{decided > 0 ? `${profile.wins}/${decided}` : '기록 없음'}</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/80 dark:bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-300 via-red-300 to-primary" style={{ width: `${Math.max(decided > 0 ? 8 : 0, Math.min(100, winRate))}%` }} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black text-foreground">최근 랭크 매치</p>
              <span className="text-[10px] font-bold text-muted-foreground">{profile.recent_matches.length}개</span>
            </div>
            {profile.recent_matches.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {profile.recent_matches.map((match) => (
                  <div key={match.id} className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/52 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black text-foreground">
                        {getArenaMatchResultLabel(match)} · {match.player_a_round_wins}:{match.player_b_round_wins}
                      </p>
                      <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{formatDateTime(match.created_at)} · {match.summary?.battlefield_rule?.name || '기본 전장'}</p>
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-white/10">
                      {match.round_count}R
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-2xl bg-secondary/40 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground">
                아직 표시할 랭크 매치가 없습니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ArenaHelpModal: React.FC<{
  mode: 'play' | 'style';
  onClose: () => void;
}> = ({ mode, onClose }) => {
  const isStyle = mode === 'style';
  const title = isStyle ? '스타일 사용 도움말' : '아레나 플레이 도움말';
  const subtitle = isStyle
    ? '꾸미기는 아레나에서 보이는 개성을 바꾸는 용도입니다.'
    : '덱과 라운드 선택이 승부의 흐름을 만드는 방식입니다.';
  const sections = isStyle
    ? [
      {
        label: '아이템 종류',
        items: [
          '프로필 프레임은 명함과 아레나 화면의 가장자리를 꾸밉니다.',
          '이름 연출은 내 닉네임을 더 선명하게 보여줍니다.',
          '배틀 이모트는 전투 화면에서 파이 메뉴로 꺼내는 표현입니다.'
        ]
      },
      {
        label: '장착 방식',
        items: [
          '이모트는 상우하좌 4방향 파이 메뉴에 직접 배치합니다.',
          '구매한 아이템은 상점과 장착 상태에서 바로 확인합니다.',
          '장착하지 않은 이모트는 전투 화면 파이 메뉴에 표시되지 않습니다.'
        ]
      },
      {
        label: '영향 범위',
        items: [
          '스타일은 전투력, 매칭, MMR, 랭킹에 영향을 주지 않습니다.',
          '상대에게 보이는 표현만 바뀌며 승부 판정과 분리됩니다.'
        ]
      }
    ]
    : [
      {
        label: '플레이 매력',
        items: [
          '좋아하는 스트리머 카드를 팀의 핵심 역할로 세울 수 있습니다.',
          '전열과 후열 배치에 따라 같은 덱도 다른 흐름을 만듭니다.',
          '한 라운드를 내줘도 다음 플랜으로 뒤집을 여지가 있습니다.'
        ]
      },
      {
        label: '전략 선택',
        items: [
          '5판 3선승 동안 라운드마다 전술 성향과 타겟 우선순위를 고릅니다.',
          '전술 칩과 보드 배치가 카드 조합의 색깔을 더 뚜렷하게 만듭니다.',
          '경기 후 리플레이로 어떤 카드가 활약했는지 다시 확인합니다.'
        ]
      },
      {
        label: '기록',
        items: [
          '빠른대전은 MMR과 랭킹에 반영됩니다.',
          'AI 연습전과 8인 컵은 기본 랭크 MMR과 분리됩니다.'
        ]
      }
    ];

  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/48 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="arena-help-modal relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/70 bg-card shadow-2xl dark:border-white/10" onClick={(event) => event.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-rose-100 via-red-50 to-pink-50 p-5 dark:from-rose-400/14 dark:via-red-400/12 dark:to-pink-400/10">
          <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-white/38 blur-2xl dark:bg-white/10" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black text-primary">ARENA HELP</p>
              <h2 className="mt-1 text-2xl font-black text-foreground">{title}</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">{subtitle}</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/74 text-sm font-black text-foreground shadow-sm dark:bg-white/10">
              ×
            </button>
          </div>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          {sections.map((section) => (
            <div key={section.label} className="arena-status-row rounded-3xl border border-border bg-secondary/38 p-4">
              <p className="text-xs font-black text-foreground">{section.label}</p>
              <div className="mt-3 space-y-2">
                {section.items.map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ArenaReplayPanel: React.FC<{
  match: ArenaMatchView;
  replay: ArenaReplay;
  currentUserId?: string;
  emoteLoadout?: ArenaCosmeticLoadout | null;
}> = ({ match, replay, currentUserId, emoteLoadout }) => {
  const [selectedRoundNo, setSelectedRoundNo] = React.useState(replay.rounds[0]?.round_no || 1);
  const [pieMenu, setPieMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [liveEmotes, setLiveEmotes] = React.useState<ArenaLiveEmote[]>([]);
  const socketRef = React.useRef<WebSocket | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const selectedRound = replay.rounds.find((round) => round.round_no === selectedRoundNo) || replay.rounds[0];
  const roundSummary = match.summary?.round_results?.find((round) => round.round_no === selectedRound?.round_no);
  const playerCards = getRoundCards(match.summary?.player_deck, selectedRound?.round_no || 1);
  const opponentCards = getRoundCards(getOpponentDeckSnapshot(match.summary), selectedRound?.round_no || 1);
  const importantEvents = (selectedRound?.events || []).filter((event) => event.type !== 'BASIC_ATTACK' || event.t % 1000 === 0).slice(0, 80);
  const equippedEmotes = React.useMemo(() => getArenaEmoteItems(emoteLoadout || null), [emoteLoadout]);

  const addLiveEmote = React.useCallback((emote: ArenaLiveEmote) => {
    setLiveEmotes((prev) => {
      const sentAt = new Date(emote.sent_at).getTime();
      const duplicate = prev.some((item) => (
        item.user_id === emote.user_id &&
        item.item.id === emote.item.id &&
        Math.abs(new Date(item.sent_at).getTime() - sentAt) < 800
      ));
      if (duplicate) return prev;
      return [...prev.slice(-4), emote];
    });
    window.setTimeout(() => {
      setLiveEmotes((prev) => prev.filter((item) => item.id !== emote.id));
    }, 2600);
  }, []);

  React.useEffect(() => {
    if (!currentUserId || typeof WebSocket === 'undefined') return;
    let cancelled = false;
    let reconnectAttempts = 0;

    const connect = () => {
      if (cancelled) return;
      const socket = new WebSocket(buildArenaRealtimeSocketUrl());
      socketRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            socket.send(JSON.stringify({ type: 'join', match_id: match.id }));
            return;
          }
          if (payload.type === 'arena_emote' && payload.match_id === match.id) {
            addLiveEmote({
              id: `${payload.user_id}-${payload.item?.id}-${payload.sent_at}`,
              match_id: payload.match_id,
              user_id: payload.user_id,
              username: payload.username,
              item: payload.item,
              sent_at: payload.sent_at
            });
          }
        } catch {
          // malformed realtime payloads are ignored
        }
      };

      socket.onopen = () => {
        reconnectAttempts = 0;
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (cancelled) return;
        const delay = Math.min(12_000, 900 + reconnectAttempts * 1200);
        reconnectAttempts += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [addLiveEmote, currentUserId, match.id]);

  const sendArenaEmote = (entry: { item: ArenaShopItem; slot: number }) => {
    setPieMenu(null);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'emote', match_id: match.id, item_id: entry.item.id, slot: entry.slot }));
    }
    if (currentUserId) {
      addLiveEmote({
        id: `local-${currentUserId}-${entry.item.id}-${Date.now()}`,
        match_id: match.id,
        user_id: currentUserId,
        username: '나',
        item: entry.item,
        sent_at: new Date().toISOString()
      });
    }
  };

  const openEmotePie = (event: React.MouseEvent<HTMLElement>) => {
    if (equippedEmotes.length === 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setPieMenu({
      x: Math.min(Math.max(event.clientX - rect.left, 96), rect.width - 96),
      y: Math.min(Math.max(event.clientY - rect.top, 96), rect.height - 96)
    });
  };

  return (
    <section className="arena-panel-soft cute-surface relative rounded-[2rem] p-5" onContextMenu={openEmotePie} onClick={() => pieMenu && setPieMenu(null)}>
      <div className="pointer-events-none absolute inset-x-4 top-20 z-20 flex flex-col items-center gap-2">
        {liveEmotes.map((emote) => (
          <div key={emote.id} className={`arena-live-emote ${emote.user_id === currentUserId ? 'is-own' : ''}`}>
            <ArenaEmoteBadge item={emote.item} size="lg" />
            <span className="mt-1 max-w-32 truncate rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-foreground shadow-sm dark:bg-card/80">
              {emote.user_id === currentUserId ? '나' : emote.username}
            </span>
          </div>
        ))}
      </div>
      {pieMenu && equippedEmotes.length > 0 ? (
        <div
          className="arena-emote-pie"
          style={{ left: pieMenu.x, top: pieMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {arenaEmoteSlots.map((slot) => {
            const entry = equippedEmotes.find((item) => item.key === slot.key);
            return (
              <button
                key={slot.key}
                type="button"
                className={`arena-emote-pie-button is-${slot.direction}`}
                onClick={() => entry && sendArenaEmote({ item: entry.item, slot: entry.slot })}
                disabled={!entry}
                aria-label={entry?.item.name || `${slot.label} 방향 비어 있음`}
              >
                {entry ? <ArenaEmoteBadge item={entry.item} size="sm" /> : <span>{slot.label}</span>}
              </button>
            );
          })}
          <div className="arena-emote-pie-core">
            <SmilePlus className="h-5 w-5" />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-black text-foreground">최근 매치 리플레이</h2>
            <p className="mt-0.5 text-xs font-bold text-muted-foreground">라운드별 결과와 주요 장면을 확인합니다.</p>
          </div>
        </div>
        <div className="flex gap-1.5 rounded-2xl bg-secondary/60 p-1">
          {replay.rounds.map((round) => (
            <button key={round.round_no} type="button" onClick={() => setSelectedRoundNo(round.round_no)} className={`rounded-xl px-3 py-1.5 text-[11px] font-black ${selectedRoundNo === round.round_no ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>
              R{round.round_no}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <ArenaMatchHighlightsPanel match={match} replay={replay} />
      </div>
      {selectedRound ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-3xl border border-rose-200/70 bg-white/70 p-3 dark:border-rose-300/20 dark:bg-white/5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-black text-rose-700 dark:text-rose-100">플레이어</p>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700 dark:bg-rose-300/15 dark:text-rose-100">{roundSummary?.player_remaining_units ?? '-'} 생존</span>
                </div>
                <div className="grid grid-cols-2 gap-2">{playerCards.map((card) => <ReplayCardTile key={card.card_id} card={card} side="player" />)}</div>
              </div>
              <div className="rounded-3xl border border-rose-200/70 bg-white/70 p-3 dark:border-rose-300/20 dark:bg-white/5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-black text-rose-700 dark:text-rose-100">상대</p>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700 dark:bg-rose-300/15 dark:text-rose-100">{roundSummary?.bot_remaining_units ?? '-'} 생존</span>
                </div>
                <div className="grid grid-cols-2 gap-2">{opponentCards.map((card) => <ReplayCardTile key={card.card_id} card={card} side="bot" />)}</div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-secondary/52 px-3 py-2"><p className="text-[10px] font-black text-muted-foreground">라운드 결과</p><p className="mt-1 text-sm font-black text-foreground">{selectedRound.winner_side === 'player' ? '플레이어 승' : selectedRound.winner_side === 'bot' ? '봇 승' : '무승부'}</p></div>
              <div className="rounded-2xl bg-secondary/52 px-3 py-2"><p className="text-[10px] font-black text-muted-foreground">전투 시간</p><p className="mt-1 text-sm font-black text-foreground">{formatReplayTime(selectedRound.duration_ms)}</p></div>
              <div className="rounded-2xl bg-secondary/52 px-3 py-2"><p className="text-[10px] font-black text-muted-foreground">피해량</p><p className="mt-1 text-sm font-black text-foreground">{roundSummary?.player_total_damage ?? 0} / {roundSummary?.bot_total_damage ?? 0}</p></div>
            </div>
          </div>
          <div className="arena-panel-soft rounded-3xl border border-border bg-card/70 p-3">
            <div className="flex items-center justify-between"><p className="text-xs font-black text-foreground">이벤트 타임라인</p><span className="text-[10px] font-black text-muted-foreground">{selectedRound.events.length} events</span></div>
            <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {importantEvents.map((event, index) => (
                <div key={`${event.t}-${event.type}-${index}`} className="arena-status-row rounded-2xl border border-transparent bg-secondary/48 px-3 py-2">
                  <div className="flex items-start gap-2"><span className="mt-0.5 w-10 shrink-0 text-[10px] font-black text-primary">{formatReplayTime(event.t)}</span><span className="min-w-0 text-[11px] font-bold leading-relaxed text-foreground">{getReplayEventLabel(event, match)}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
const ArenaCardPreview: React.FC<{ card: ArenaCard }> = ({ card }) => {
  const tone = roleToneClass[card.class.role] || roleToneClass.tempo;
  const initial = card.name.trim().slice(0, 1) || 'A';
  const visibleTags = Array.from(new Set(card.skills.flatMap((skill) => skill.tags || []))).slice(0, 4);
  return (
    <article className="arena-card-preview cute-card-pop group overflow-hidden rounded-3xl border border-white/70 bg-white/86 shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/78">
      <div className={`arena-card-media relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${tone}`}>
        {card.image_url ? (
          <img src={card.image_url} alt={card.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden text-primary">
            <div className="absolute inset-x-0 top-6 h-px bg-white/65" />
            <div className="absolute -left-8 top-1/3 h-12 w-[140%] -rotate-12 bg-white/20" />
            <div className="relative flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/80 bg-white/72 text-5xl font-black shadow-xl shadow-primary/15 dark:border-white/10 dark:bg-white/10">
              {initial}
            </div>
            <Sparkles className="absolute right-5 top-5 h-6 w-6 text-primary/70" />
          </div>
        )}
        <ArenaClassTooltip cardClass={card.class} className="absolute left-3 top-3">
          <span className="rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-black text-foreground shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/88">
            {card.class.name}
          </span>
        </ArenaClassTooltip>
        <ArenaRoleTooltip role={card.class.role} className="absolute bottom-3 right-3">
          <span className="rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-black text-primary shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/88">
            {roleLabels[card.class.role] || card.class.role}
          </span>
        </ArenaRoleTooltip>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="truncate text-sm font-black text-foreground">{card.name}</h3>
          <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">
            <ArenaRoleTooltip role={card.class.role}>
              <span>{roleLabels[card.class.role] || card.class.role}</span>
            </ArenaRoleTooltip>
            <span> · 동일 스트리머 고정 능력</span>
          </p>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {statLabels.map(([key, label]) => (
            <ArenaStatTooltip key={key} statKey={key} label={label} value={card.stats[key]} className="block">
              <span className="arena-stat-cell block rounded-2xl px-1.5 py-2 text-center">
                <span className="block text-[9px] font-black text-muted-foreground">{label}</span>
                <span className="mt-0.5 block text-xs font-black text-foreground">{card.stats[key]}</span>
              </span>
            </ArenaStatTooltip>
          ))}
        </div>
        {card.skills.length > 0 ? (
          <div className="arena-skill-panel rounded-2xl border border-primary/15 px-3 py-2">
            <ArenaSkillList skills={card.skills} />
            {visibleTags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {visibleTags.map((tag) => <ArenaTagBadge key={tag} tag={tag} />)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
};

const ArenaCompactCardPreview: React.FC<{ card: ArenaCard }> = ({ card }) => {
  const initial = card.name.trim().slice(0, 1) || 'A';
  return (
    <article className="arena-card-preview cute-card-pop group rounded-3xl border border-white/70 bg-white/82 p-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/72">
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-primary/10 text-primary shadow-sm">
          {card.image_url ? (
            <img src={card.image_url} alt={card.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-black">{initial}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-black text-foreground">{card.name}</h3>
          </div>
          <p className="mt-1 truncate text-[11px] font-bold text-muted-foreground">
            <ArenaClassTooltip cardClass={card.class}>
              <span>{card.class.name}</span>
            </ArenaClassTooltip>
            <span> · </span>
            <ArenaRoleTooltip role={card.class.role}>
              <span>{roleLabels[card.class.role] || card.class.role}</span>
            </ArenaRoleTooltip>
          </p>
          <ArenaSkillList skills={card.skills} compact />
        </div>
      </div>
    </article>
  );
};
const arenaCosmeticTypeLabels: Record<ArenaShopItem['type'], string> = {
  border: '프로필 프레임',
  name_effect: '이름 연출',
  emote: '배틀 이모트'
};

const ArenaMiniCardSurface: React.FC<{
  border?: Pick<ArenaShopItem, 'style_json'> | null;
  nameEffect?: Pick<ArenaShopItem, 'style_json' | 'font_url' | 'font_family'> | null;
  name?: string;
  className?: string;
}> = ({ border, nameEffect, name = 'ARENA', className }) => {
  React.useEffect(() => {
    ensureCosmeticCss(border || null);
  }, [border?.style_json]);
  const inlineBorderStyle = border && !borderClass(border) ? borderStyle(border) : {};
  return (
    <div
      className={`relative flex h-[5.2rem] w-14 shrink-0 flex-col justify-between overflow-hidden rounded-xl border border-white/70 bg-gradient-to-br from-rose-100 via-white to-pink-100 p-1.5 text-left shadow-xl shadow-rose-900/10 dark:border-white/10 dark:from-rose-300/20 dark:via-white/8 dark:to-pink-300/14 ${className || ''}`}
      style={{ containerType: 'inline-size', ...inlineBorderStyle }}
    >
      <CosmeticFrame border={border || null} />
      <div className="relative z-10 flex items-center justify-between">
        <span className="rounded bg-white/74 px-1 py-0.5 text-[6px] font-black text-rose-700 dark:bg-white/10 dark:text-rose-100">A</span>
        <span className="rounded bg-rose-900/12 px-1 py-0.5 text-[6px] font-black text-rose-700 dark:bg-white/10 dark:text-rose-100">5</span>
      </div>
      <div className="relative z-10 min-w-0">
        <CosmeticName effect={nameEffect || null} className="block truncate text-[9px] font-black leading-tight text-foreground">
          {name}
        </CosmeticName>
        <p className="mt-0.5 text-[6px] font-black text-muted-foreground">STYLE PREVIEW</p>
      </div>
    </div>
  );
};

const ArenaCosmeticItemPreview: React.FC<{ item: ArenaShopItem }> = ({ item }) => {
  if (item.type === 'emote') {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ArenaEmoteBadge item={item} size="lg" />
      </div>
    );
  }

  if (item.type === 'border') {
    return (
      <div className="flex h-full w-full items-center justify-center gap-3 px-3">
        <ArenaMiniCardSurface border={item} name="ARENA" />
        <div className="min-w-0 text-left">
          <p className="text-[10px] font-black text-primary">프레임 적용</p>
          <p className="mt-1 line-clamp-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
            카드 표면의 테두리와 오버레이가 실제 렌더링됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center gap-3 px-3">
      <ArenaMiniCardSurface nameEffect={item} name="치카포 아레나" />
      <div className="min-w-0 text-left">
        <p className="text-[10px] font-black text-primary">이름 연출 적용</p>
        <CosmeticName effect={item} className="mt-1 block max-w-[9rem] truncate text-sm font-black text-foreground">
          치카포 아레나
        </CosmeticName>
      </div>
    </div>
  );
};

const ArenaStylePreview: React.FC<{
  userName: string;
  loadout: ArenaCosmeticLoadout | null;
}> = ({ userName, loadout }) => (
  <div className="arena-style-preview rounded-[1.75rem] border border-white/70 bg-white/72 p-4 shadow-sm dark:border-white/10 dark:bg-white/8">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black text-primary">장착 미리보기</p>
        <h3 className="mt-1 text-sm font-black text-foreground">아레나 프로필 스타일</h3>
      </div>
      <Palette className="h-5 w-5 text-primary" />
    </div>
    <div className="mt-4 flex items-center gap-3 rounded-3xl bg-secondary/45 p-3">
      <ArenaMiniCardSurface border={loadout?.border_item || null} nameEffect={loadout?.name_effect_item || null} name={userName} className="h-20 w-14" />
      <div className="min-w-0 flex-1">
        <CosmeticName effect={loadout?.name_effect_item || null} className="arena-style-name block truncate text-lg font-black">
          {userName}
        </CosmeticName>
        <p className="mt-1 text-[11px] font-bold text-muted-foreground">
          {loadout?.border_item?.name || '기본 프레임'} · {loadout?.name_effect_item?.name || '기본 이름'}
        </p>
      </div>
    </div>
    <div className="mt-3 grid grid-cols-4 gap-2">
      {arenaEmoteSlots.map((slot) => {
        const item = loadout?.[slot.itemKey] as ArenaShopItem | null | undefined;
        return (
          <div key={slot.key} className="arena-emote-slot-preview rounded-2xl bg-card/66 p-2 text-center dark:bg-white/10">
            <div className="mx-auto flex h-12 items-center justify-center">
              {item ? <ArenaEmoteBadge item={item} size="sm" /> : <span className="text-xs font-black text-muted-foreground">-</span>}
            </div>
            <p className="mt-1 truncate text-[9px] font-black text-muted-foreground">{item?.name || slot.label}</p>
          </div>
        );
      })}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {[
        ['승률 영향', '없음'],
        ['MMR 영향', '없음'],
        ['전투 정보', '비연결'],
        ['적용 범위', '아레나 표시']
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-card/66 px-3 py-2 text-center dark:bg-white/10">
          <p className="text-[9px] font-black text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xs font-black text-foreground">{value}</p>
        </div>
      ))}
    </div>
  </div>
);

const ArenaCosmeticCard: React.FC<{
  item: ArenaShopItem;
  ownedCount: number;
  purchaseCount: number;
  equipped: boolean;
  userPoint: number;
  buying: boolean;
  equipping: boolean;
  onBuy: (item: ArenaShopItem) => void;
  onEquip: (item: ArenaShopItem) => void;
  onUnequip: (item: ArenaShopItem) => void;
}> = ({ item, ownedCount, purchaseCount, equipped, userPoint, buying, equipping, onBuy, onEquip, onUnequip }) => {
  const saleState = getArenaShopSaleState(item);
  const limited = item.purchase_limit > 0;
  const limitReached = limited && purchaseCount >= item.purchase_limit;
  const blocked = saleState.notStarted || saleState.ended || saleState.totalSoldOut || limitReached;
  const canAfford = userPoint >= Math.max(0, Number(item.price || 0));
  const stockLeft = Math.max(0, saleState.total - saleState.sold);

  return (
    <article className="shop-cosmetic-card arena-cosmetic-card cute-card-pop grid min-h-[18rem] grid-rows-[5.75rem_auto_1fr_auto] rounded-[1.35rem] border border-border bg-card/76 p-3 text-center shadow-sm">
      <div className="cosmetic-list-preview arena-cosmetic-preview relative mx-auto flex h-[5.4rem] w-full items-center justify-center overflow-hidden rounded-3xl bg-secondary/50">
        <ArenaCosmeticItemPreview item={item} />
        <span className="absolute left-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-black text-muted-foreground dark:bg-white/10">
          {arenaCosmeticTypeLabels[item.type]}
        </span>
      </div>
      <div className="mt-3 min-h-[3.4rem]">
        <p className="truncate text-xs font-black text-foreground">{item.name}</p>
        <p className="mt-1 line-clamp-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          {item.description || '아레나 화면에서 개성을 보여주는 코스메틱입니다.'}
        </p>
      </div>
      <div className="mt-3 flex flex-col justify-end gap-2">
        {saleState.isLimited ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/70 px-3 py-2 text-[10px] font-black text-red-700 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100">
            {saleState.total > 0 ? `한정 수량 ${stockLeft}/${saleState.total}` : saleState.notStarted ? '판매 예정' : saleState.ended ? '판매 종료' : '기간 한정'}
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-black">
          <span className="rounded-xl bg-secondary/60 px-2 py-1 text-muted-foreground">보유 {ownedCount}</span>
          <span className="rounded-xl bg-secondary/60 px-2 py-1 text-muted-foreground">구매 {purchaseCount}</span>
          <span className={`rounded-xl px-2 py-1 ${equipped ? 'bg-rose-100 text-rose-700 dark:bg-rose-300/15 dark:text-rose-100' : 'bg-secondary/60 text-muted-foreground'}`}>
            {equipped ? '장착' : '미장착'}
          </span>
        </div>
        <p className="cute-number-font flex items-center justify-center gap-1 text-sm font-black text-primary">
          <Coins className="h-3.5 w-3.5" />
          {Number(item.price || 0).toLocaleString()} P
        </p>
      </div>
      <div className="mt-3 grid gap-2">
        {ownedCount > 0 ? (
          equipped ? (
            <button
              type="button"
              onClick={() => onUnequip(item)}
              disabled={equipping}
              className="cute-wiggle-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 text-[11px] font-black text-foreground disabled:opacity-50"
            >
              <Palette className="h-3.5 w-3.5" />
              {equipping ? '해제 중' : '아레나에서 해제'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onEquip(item)}
              disabled={equipping}
              className="arena-primary-cta cute-wiggle-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 text-[11px] font-black text-primary-foreground disabled:opacity-50"
            >
              <Palette className="h-3.5 w-3.5" />
              {equipping ? '장착 중' : '아레나에 장착'}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => onBuy(item)}
            disabled={buying || blocked || !canAfford}
            className="arena-primary-cta cute-wiggle-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 text-[11px] font-black text-primary-foreground disabled:opacity-50"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            {buying ? '구매 중' : !canAfford ? '포인트 부족' : blocked ? '구매 불가' : '아레나에서 구매'}
          </button>
        )}
      </div>
    </article>
  );
};

type ArenaTabProps = {
  activeSiteTab?: ArenaSiteTab;
  onSiteTabChange?: (tab: ArenaSiteTab) => void;
  hideSiteTabs?: boolean;
};

export const ArenaTab: React.FC<ArenaTabProps> = ({ activeSiteTab, onSiteTabChange, hideSiteTabs = false }) => {
  const { user, toast, updatePoints, refreshUserData } = useApp();
  const router = useRouter();
  const previewSectionRef = React.useRef<HTMLElement | null>(null);
  const roundRevealTimerRef = React.useRef<number | null>(null);
  const autoRoundCommitKeyRef = React.useRef<string | null>(null);
  const arenaCosmeticsLoadPromiseRef = React.useRef<Promise<void> | null>(null);
  const arenaCosmeticsLoadedAtRef = React.useRef(0);
  const [internalArenaSiteTab, setInternalArenaSiteTab] = React.useState<ArenaSiteTab>('play');
  const arenaSiteTab = activeSiteTab || internalArenaSiteTab;
  const setArenaSiteTab = React.useCallback((tab: ArenaSiteTab) => {
    if (onSiteTabChange) onSiteTabChange(tab);
    else setInternalArenaSiteTab(tab);
  }, [onSiteTabChange]);
  const [status, setStatus] = React.useState<ArenaSystemStatus | null>(null);
  const [season, setSeason] = React.useState<ArenaSeason['season'] | null>(null);
  const [rulesCatalog, setRulesCatalog] = React.useState<ArenaRulesCatalog | null>(null);
  const [cards, setCards] = React.useState<ArenaCard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [myStreamerCard, setMyStreamerCard] = React.useState<MyArenaStreamerCard | null>(null);
  const [myStreamerCardDraft, setMyStreamerCardDraft] = React.useState<ArenaStreamerCardConfig>({
    skill_ids: [],
    tag_ids: []
  });
  const [myCardLoading, setMyCardLoading] = React.useState(false);
  const [myCardActionLoading, setMyCardActionLoading] = React.useState(false);
  const [myCardConfigSaving, setMyCardConfigSaving] = React.useState(false);
  const [decks, setDecks] = React.useState<ArenaDeck[]>([]);
  const [deckLoading, setDeckLoading] = React.useState(false);
  const [deckError, setDeckError] = React.useState<string | null>(null);
  const [deckActionLoading, setDeckActionLoading] = React.useState(false);
  const [deckEditorId, setDeckEditorId] = React.useState<string | null>(null);
  const [deckEditorName, setDeckEditorName] = React.useState('아레나 덱');
  const [deckEditorCardIds, setDeckEditorCardIds] = React.useState<string[]>([]);
  const [deckEditorSearch, setDeckEditorSearch] = React.useState('');
  const [deckEditorSaving, setDeckEditorSaving] = React.useState(false);
  const [botMatchLoadingDeckId, setBotMatchLoadingDeckId] = React.useState<string | null>(null);
  const [selectedReplayMatch, setSelectedReplayMatch] = React.useState<ArenaMatchView | null>(null);
  const [selectedReplay, setSelectedReplay] = React.useState<ArenaReplay | null>(null);
  const [roundCommitLoading, setRoundCommitLoading] = React.useState(false);
  const [roundCommitTactic, setRoundCommitTactic] = React.useState('balanced');
  const [roundCommitFocus, setRoundCommitFocus] = React.useState('frontline_first');
  const [roundCommitChipId, setRoundCommitChipId] = React.useState('none');
  const [roundReveal, setRoundReveal] = React.useState<ArenaRoundReveal | null>(null);
  const [roundWait, setRoundWait] = React.useState<ArenaRoundWaitState | null>(null);
  const [roundWaitNow, setRoundWaitNow] = React.useState(() => Date.now());
  const [quickMatchLoadingDeckId, setQuickMatchLoadingDeckId] = React.useState<string | null>(null);
  const [quickMatch, setQuickMatch] = React.useState<ArenaQuickMatch | null>(null);
  const [cupLoadingDeckId, setCupLoadingDeckId] = React.useState<string | null>(null);
  const [cupStatus, setCupStatus] = React.useState<ArenaCupStatus | null>(null);
  const [lastCup, setLastCup] = React.useState<ArenaCupDetail | null>(null);
  const [queueModalDismissedFor, setQueueModalDismissedFor] = React.useState<string | null>(null);
  const arenaQueueNotificationKeysRef = React.useRef<Set<string>>(new Set());
  const [profile, setProfile] = React.useState<ArenaProfile | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [rankings, setRankings] = React.useState<ArenaRankings | null>(null);
  const [rankingsLoading, setRankingsLoading] = React.useState(false);
  const [rankingsError, setRankingsError] = React.useState<string | null>(null);
  const [profileCardUser, setProfileCardUser] = React.useState<ArenaUserProfile | null>(null);
  const [profileCardLoadingId, setProfileCardLoadingId] = React.useState<string | null>(null);
  const [profileCardError, setProfileCardError] = React.useState<string | null>(null);
  const [ownedCards, setOwnedCards] = React.useState<ArenaCard[]>([]);
  const [ownedCardsLoading, setOwnedCardsLoading] = React.useState(false);
  const [ownedCardsError, setOwnedCardsError] = React.useState<string | null>(null);
  const [recentMatches, setRecentMatches] = React.useState<ArenaRecentMatch[]>([]);
  const [recentMatchesLoading, setRecentMatchesLoading] = React.useState(false);
  const [recentMatchesError, setRecentMatchesError] = React.useState<string | null>(null);
  const [spectatorShareToken, setSpectatorShareToken] = React.useState('');
  const [spectatorReplay, setSpectatorReplay] = React.useState<ArenaSpectatorReplay | null>(null);
  const [spectatorLoading, setSpectatorLoading] = React.useState(false);
  const [spectatorError, setSpectatorError] = React.useState<string | null>(null);
  const [shareLoadingMatchId, setShareLoadingMatchId] = React.useState<string | null>(null);
  const [arenaStyleFilter, setArenaStyleFilter] = React.useState<ArenaStyleFilter>('all');
  const [arenaShopItems, setArenaShopItems] = React.useState<ArenaShopItem[]>([]);
  const [arenaCosmeticOwned, setArenaCosmeticOwned] = React.useState<Record<number, number>>({});
  const [arenaCosmeticPurchases, setArenaCosmeticPurchases] = React.useState<Record<number, number>>({});
  const [arenaCosmeticLoadout, setArenaCosmeticLoadout] = React.useState<ArenaCosmeticLoadout | null>(null);
  const [arenaCosmeticsLoading, setArenaCosmeticsLoading] = React.useState(false);
  const [arenaCosmeticsError, setArenaCosmeticsError] = React.useState<string | null>(null);
  const [arenaCosmeticBuyingId, setArenaCosmeticBuyingId] = React.useState<number | null>(null);
  const [arenaCosmeticEquippingId, setArenaCosmeticEquippingId] = React.useState<number | null>(null);
  const [arenaHelpModal, setArenaHelpModal] = React.useState<'play' | 'style' | null>(null);

  const loadArenaPreview = React.useCallback(async () => {
    setLoading(true);
    setPreviewError(null);
    try {
      const [statusRes, seasonRes, cardsRes, rulesRes] = await Promise.all([
        apiFetch('/arena/system-status'),
        apiFetch('/arena/seasons/current'),
        apiFetch('/arena/cards?limit=10'),
        apiFetch('/arena/rules/catalog')
      ]);
      if (!statusRes.ok || !seasonRes.ok || !cardsRes.ok || !rulesRes.ok) {
        throw new Error('Arena API response was not ok');
      }
      const statusData = await statusRes.json();
      const seasonData = await seasonRes.json();
      const cardsData = await cardsRes.json();
      const rulesData = await rulesRes.json();
      setStatus(statusData);
      setSeason(seasonData.season || null);
      setCards(Array.isArray(cardsData.items) ? cardsData.items : []);
      setRulesCatalog(rulesData || null);
    } catch (err) {
      console.warn('[ArenaTab] 아레나 프리뷰 로드 실패:', err);
      setPreviewError('아레나 기본 정보를 불러오지 못했습니다. 연결이 회복되면 다시 시도할 수 있습니다.');
      toast('아레나 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [toast]);


  const loadMyArenaStreamerCard = React.useCallback(async () => {
    if (!user) {
      setMyStreamerCard(null);
      return;
    }
    setMyCardLoading(true);
    try {
      const res = await apiFetch('/arena/streamer-card/me');
      if (res.status === 404) {
        setMyStreamerCard(null);
        return;
      }
      if (!res.ok) throw new Error('Arena streamer card response was not ok');
      const data = await res.json();
      const payload = data.data || null;
      setMyStreamerCard(payload);
      if (payload) {
        const savedConfig = payload.state?.config || {};
        setMyStreamerCardDraft({
          class_id: savedConfig.class_id || payload.card?.class?.id || payload.config_options?.classes?.[0]?.id,
          stat_focus: savedConfig.stat_focus || 'hp',
          combat_style: savedConfig.combat_style || 'balanced',
          skill_ids: Array.isArray(savedConfig.skill_ids) ? savedConfig.skill_ids : pickDefaultSkillIds(payload.card?.skills || []),
          tag_ids: Array.isArray(savedConfig.tag_ids) ? savedConfig.tag_ids : [],
          flavor_text: savedConfig.flavor_text || ''
        });
      }
    } catch (err) {
      console.warn('[ArenaTab] 내 아레나 카드 로드 실패:', err);
    } finally {
      setMyCardLoading(false);
    }
  }, [user]);

  const toggleMyArenaCard = async (nextEnabled: boolean) => {
    if (!user || myCardActionLoading) return;
    setMyCardActionLoading(true);
    try {
      const res = await apiFetch('/arena/streamer-card/me/' + (nextEnabled ? 'enable' : 'disable'), { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena streamer card toggle failed');
      toast(nextEnabled ? '아레나 카드 재활성화를 요청했습니다. 다음 카드 풀 갱신부터 반영됩니다.' : '아레나 카드가 신규 아레나 매치에서 제외됩니다.', 'success');
      await loadMyArenaStreamerCard();
      if (!nextEnabled) await loadArenaPreview();
    } catch (err: any) {
      toast(err?.message || '아레나 카드 상태 변경에 실패했습니다.', 'error');
    } finally {
      setMyCardActionLoading(false);
    }
  };

  const updateMyStreamerCardDraft = (patch: Partial<ArenaStreamerCardConfig>) => {
    setMyStreamerCardDraft((current) => ({ ...current, ...patch }));
  };

  const updateMyStreamerSkillSlot = (slotType: ArenaSkillSlotType, skillId: string) => {
    setMyStreamerCardDraft((current) => {
      const currentIds = Array.isArray(current.skill_ids) ? current.skill_ids : [];
      const currentByType = new Map<ArenaSkillSlotType, string>();
      arenaSkillSlotTypes.forEach((type) => {
        const selected = streamerSkillOptions.find((skill) => skill.type === type && currentIds.includes(skill.id));
        if (selected) currentByType.set(type, selected.id);
      });
      if (skillId) currentByType.set(slotType, skillId);
      else currentByType.delete(slotType);
      return {
        ...current,
        skill_ids: arenaSkillSlotTypes
          .map((type) => currentByType.get(type))
          .filter((id): id is string => Boolean(id))
      };
    });
  };

  const toggleMyStreamerTag = (tagId: string) => {
    const maxTags = myStreamerCard?.config_options?.limits?.tag_ids || 4;
    setMyStreamerCardDraft((current) => {
      const currentIds = Array.isArray(current.tag_ids) ? current.tag_ids : [];
      if (currentIds.includes(tagId)) {
        return { ...current, tag_ids: currentIds.filter((id) => id !== tagId) };
      }
      return { ...current, tag_ids: [...currentIds, tagId].slice(0, maxTags) };
    });
  };

  const saveMyStreamerCardConfig = async (resetConfig = false) => {
    if (!user || !myStreamerCard || myCardConfigSaving) return;
    setMyCardConfigSaving(true);
    try {
      const res = await apiFetch('/arena/streamer-card/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetConfig ? { reset_config: true } : myStreamerCardDraft)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena streamer card config save failed');
      setMyStreamerCard(data.data || null);
      if (data.data?.state?.config || resetConfig) {
        const savedConfig = data.data?.state?.config || {};
        setMyStreamerCardDraft({
          class_id: savedConfig.class_id || data.data?.card?.class?.id,
          stat_focus: savedConfig.stat_focus || 'hp',
          combat_style: savedConfig.combat_style || 'balanced',
          skill_ids: Array.isArray(savedConfig.skill_ids) ? savedConfig.skill_ids : pickDefaultSkillIds(data.data?.card?.skills || []),
          tag_ids: Array.isArray(savedConfig.tag_ids) ? savedConfig.tag_ids : [],
          flavor_text: savedConfig.flavor_text || ''
        });
      }
      toast(resetConfig ? '아레나 카드 설정을 자동 템플릿으로 되돌렸습니다.' : '아레나 카드 콘셉트를 저장했습니다.', 'success');
      await loadArenaPreview();
    } catch (err: any) {
      toast(err?.message || '아레나 카드 설정 저장에 실패했습니다.', 'error');
    } finally {
      setMyCardConfigSaving(false);
    }
  };

  const loadMyArenaDecks = React.useCallback(async () => {
    if (!user) {
      setDecks([]);
      return [] as ArenaDeck[];
    }
    setDeckLoading(true);
    setDeckError(null);
    try {
      const res = await apiFetch('/arena/decks');
      if (!res.ok) throw new Error('Arena decks response was not ok');
      const data = await res.json();
      const items = Array.isArray(data.data?.items) ? data.data.items as ArenaDeck[] : [];
      setDecks(items);
      return items;
    } catch (err) {
      console.warn('[ArenaTab] 내 아레나 덱 로드 실패:', err);
      setDeckError('저장된 덱을 불러오지 못했습니다.');
      return [] as ArenaDeck[];
    } finally {
      setDeckLoading(false);
    }
  }, [user]);

  const loadMyOwnedArenaCards = React.useCallback(async () => {
    if (!user) {
      setOwnedCards([]);
      return;
    }
    setOwnedCardsLoading(true);
    setOwnedCardsError(null);
    try {
      const res = await apiFetch('/arena/cards/owned?limit=5000');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Owned arena cards response was not ok');
      setOwnedCards(Array.isArray(data.data?.items) ? data.data.items : []);
    } catch (err) {
      console.warn('[ArenaTab] 보유 아레나 카드 로드 실패:', err);
      setOwnedCardsError('보유 카드북을 불러오지 못했습니다.');
      setOwnedCards([]);
    } finally {
      setOwnedCardsLoading(false);
    }
  }, [user]);

  const loadMyRecentArenaMatches = React.useCallback(async () => {
    if (!user) {
      setRecentMatches([]);
      return;
    }
    setRecentMatchesLoading(true);
    setRecentMatchesError(null);
    try {
      const res = await apiFetch('/arena/matches/recent?limit=8');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Recent arena matches response was not ok');
      setRecentMatches(Array.isArray(data.data?.items) ? data.data.items : []);
    } catch (err) {
      console.warn('[ArenaTab] 최근 아레나 매치 로드 실패:', err);
      setRecentMatchesError('최근 경기 기록을 불러오지 못했습니다.');
      setRecentMatches([]);
    } finally {
      setRecentMatchesLoading(false);
    }
  }, [user]);

  const loadArenaProfile = React.useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await apiFetch('/arena/profile/me');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena profile response was not ok');
      setProfile(data.data || null);
    } catch (err) {
      console.warn('[ArenaTab] 내 아레나 프로필 로드 실패:', err);
      setProfileError('내 랭크 정보를 불러오지 못했습니다.');
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  const loadArenaRankings = React.useCallback(async () => {
    setRankingsLoading(true);
    setRankingsError(null);
    try {
      const res = await apiFetch('/arena/rankings?limit=100');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena rankings response was not ok');
      setRankings(data.data || null);
    } catch (err) {
      console.warn('[ArenaTab] 아레나 랭킹 로드 실패:', err);
      setRankingsError('랭킹 정보를 불러오지 못했습니다.');
      setRankings(null);
    } finally {
      setRankingsLoading(false);
    }
  }, []);

  const openArenaProfileCard = React.useCallback(async (userId: string) => {
    const trimmed = String(userId || '').trim();
    if (!trimmed) return;
    setProfileCardError(null);
    setProfileCardLoadingId(trimmed);
    try {
      const res = await apiFetch(`/arena/profile/${encodeURIComponent(trimmed)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena user profile response was not ok');
      setProfileCardUser(data.data || null);
    } catch (err: any) {
      setProfileCardError(err?.message || '아레나 전적을 불러오지 못했습니다.');
      setProfileCardUser(null);
      toast(err?.message || '아레나 전적을 불러오지 못했습니다.', 'error');
    } finally {
      setProfileCardLoadingId(null);
    }
  }, [toast]);

  const resetDeckEditor = React.useCallback(() => {
    setDeckEditorId(null);
    setDeckEditorName('아레나 덱');
    setDeckEditorCardIds([]);
    setDeckEditorSearch('');
  }, []);

  const startNewDeckEditor = React.useCallback(() => {
    setDeckEditorId(null);
    setDeckEditorName(decks.length > 0 ? `아레나 덱 ${decks.length + 1}` : '프리시즌 기본 덱');
    setDeckEditorCardIds(ownedCards.slice(0, ARENA_DECK_CARD_LIMIT).map((card) => card.card_id));
  }, [decks.length, ownedCards]);

  const openDeckEditor = React.useCallback((deck: ArenaDeck) => {
    setDeckEditorId(deck.id);
    setDeckEditorName(deck.name || '아레나 덱');
    setDeckEditorCardIds(deck.cards.slice(0, ARENA_DECK_CARD_LIMIT).map((card) => card.card_id));
  }, []);

  const toggleDeckEditorCard = React.useCallback((cardId: string) => {
    setDeckEditorCardIds((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= ARENA_DECK_CARD_LIMIT) {
        toast(`덱은 최대 ${ARENA_DECK_CARD_LIMIT}장까지 구성할 수 있습니다.`, 'warning');
        return current;
      }
      return [...current, cardId];
    });
  }, [toast]);

  const saveDeckEditor = async () => {
    if (!user || deckEditorSaving) return;
    const cardIds = Array.from(new Set(deckEditorCardIds));
    if (cardIds.length < 6 || cardIds.length > ARENA_DECK_CARD_LIMIT) {
      toast(`덱은 6~${ARENA_DECK_CARD_LIMIT}장의 보유 카드로 구성해야 합니다.`, 'warning');
      return;
    }
    setDeckEditorSaving(true);
    try {
      const body = JSON.stringify({
        name: (deckEditorName.trim() || '아레나 덱').slice(0, 80),
        card_ids: cardIds,
        strategy_chip_id: 'none'
      });
      const res = await apiFetch(deckEditorId ? `/arena/decks/${deckEditorId}` : '/arena/decks', {
        method: deckEditorId ? 'PATCH' : 'POST',
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.validation?.errors) ? data.validation.errors[0] : data.message;
        throw new Error(detail || 'Arena deck save failed');
      }
      const responseDeck = (data.data?.deck || data.data) as ArenaDeck | undefined;
      const refreshedDecks = await loadMyArenaDecks();
      const savedDeck = refreshedDecks.find((deck) => responseDeck?.id && deck.id === responseDeck.id) || responseDeck;
      if (!savedDeck?.id || !Array.isArray(savedDeck.cards) || savedDeck.cards.length < 6) {
        throw new Error('아레나 덱 저장 결과를 다시 불러오지 못했습니다. 덱 새로고침 후 확인해주세요.');
      }
      openDeckEditor(savedDeck);
      toast(deckEditorId ? '아레나 덱을 수정했습니다.' : '아레나 덱을 저장했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '아레나 덱 저장에 실패했습니다.', 'error');
    } finally {
      setDeckEditorSaving(false);
    }
  };

  const createStarterDeck = async () => {
    if (!user || deckActionLoading) return;
    if (ownedCards.length < 6) {
      toast('덱을 만들 보유 아레나 카드가 아직 충분하지 않습니다.', 'warning');
      return;
    }
    setDeckEditorId(null);
    setDeckEditorName(decks.length > 0 ? `아레나 덱 ${decks.length + 1}` : '프리시즌 기본 덱');
    setDeckEditorCardIds(ownedCards.slice(0, ARENA_DECK_CARD_LIMIT).map((card) => card.card_id));
    toast('보유 카드로 덱 초안을 만들었습니다. 저장하면 대전에 사용할 수 있습니다.', 'success');
  };

  const deleteDeck = async (deckId: string) => {
    if (!user || deckActionLoading) return;
    setDeckActionLoading(true);
    try {
      const res = await apiFetch(`/arena/decks/${deckId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena deck delete failed');
      toast('아레나 덱을 삭제했습니다.', 'success');
      if (deckEditorId === deckId) resetDeckEditor();
      await loadMyArenaDecks();
    } catch (err: any) {
      toast(err?.message || '아레나 덱 삭제에 실패했습니다.', 'error');
    } finally {
      setDeckActionLoading(false);
    }
  };
  const openArenaMatchForRoundPlay = React.useCallback(async (matchId: string) => {
    const res = await apiFetch(`/arena/matches/${encodeURIComponent(matchId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '아레나 매치를 불러오지 못했습니다.');
    const match = data.data?.match || data.data || null;
    setSelectedReplayMatch(match);
    setRoundWait(null);
    setRoundReveal(null);
    setSelectedReplay({
      match_id: match.id,
      match_format: 'best_of_five',
      rounds_to_win: 3,
      replay_storage: 'tick_events',
      rounds: []
    } as ArenaReplay);
    const nextRoundNo = match?.summary?.current_round_no || 1;
    const nextPlan = match?.summary?.player_deck?.round_plans?.find((plan: any) => plan.round_no === nextRoundNo)
      || match?.summary?.player_deck?.round_plans?.[0];
    setRoundCommitTactic(nextPlan?.tactic_style || 'balanced');
    setRoundCommitFocus(nextPlan?.focus_rule || 'frontline_first');
    setRoundCommitChipId(match?.summary?.player_deck?.strategy_chip_id || 'none');
    if (match?.id) router.push(arenaMatchHref(match.id));
  }, [router]);

  const notifyArenaQueueMatched = React.useCallback((kind: 'quick' | 'cup', id: string | null | undefined) => {
    if (!id || typeof document === 'undefined' || document.visibilityState === 'visible') return;
    const key = `${kind}:${id}`;
    if (arenaQueueNotificationKeysRef.current.has(key)) return;
    arenaQueueNotificationKeysRef.current.add(key);
    void showArenaInactiveNotification({
      tag: `arena-${key}`,
      title: kind === 'quick' ? '아레나 빠른대전 매칭 완료' : '아레나 8인 컵 완료',
      body: kind === 'quick'
        ? '상대가 잡혔습니다. 라운드 전술을 선택하세요.'
        : '8인 컵 결과가 도착했습니다. 결과와 리플레이를 확인하세요.',
      url: kind === 'quick' ? arenaMatchHref(id) : '/arena/play'
    });
  }, []);
  const loadQuickMatchStatus = React.useCallback(async (showToast = false) => {
    if (!user || !season?.quick_match_enabled) return;
    try {
      const res = await apiFetch('/arena/matchmaking/quick/status');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena quick match status failed');
      const next = data.data || null;
      setQuickMatch(next);
      if (next?.status === 'matched' && next.match_id) {
        notifyArenaQueueMatched('quick', next.match_id);
        await openArenaMatchForRoundPlay(next.match_id);
        if (showToast) toast('빠른대전 매칭이 완료되었습니다. 1라운드 전술을 선택하세요.', 'success');
      }
    } catch (err: any) {
      if (showToast) toast(err?.message || '빠른대전 상태 조회에 실패했습니다.', 'error');
    }
  }, [notifyArenaQueueMatched, openArenaMatchForRoundPlay, season?.quick_match_enabled, toast, user]);

  const startQuickMatch = async (deckId: string) => {
    if (!user || quickMatchLoadingDeckId) return;
    if (!season?.quick_match_enabled) {
      toast('빠른대전은 현재 비활성화되어 있습니다.', 'warning');
      return;
    }
    setQuickMatchLoadingDeckId(deckId);
    setQueueModalDismissedFor(null);
    try {
      const res = await apiFetch('/arena/matchmaking/quick/join', {
        method: 'POST',
        body: JSON.stringify({ deck_id: deckId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.validation?.errors) ? data.validation.errors[0] : data.message;
        throw new Error(detail || 'Arena quick match failed');
      }
      const next = data.data || null;
      setQuickMatch(next);
      if (next?.status === 'matched' && next.match_id) {
        notifyArenaQueueMatched('quick', next.match_id);
        await openArenaMatchForRoundPlay(next.match_id);
        toast('빠른대전 매칭이 완료되었습니다. 1라운드 전술을 선택하세요.', 'success');
      } else {
        toast('빠른대전 큐에 등록했습니다.', 'success');
      }
    } catch (err: any) {
      toast(err?.message || '빠른대전 큐 등록에 실패했습니다.', 'error');
    } finally {
      setQuickMatchLoadingDeckId(null);
    }
  };

  const cancelQuickMatch = async () => {
    if (!user || !season?.quick_match_enabled || quickMatch?.status !== 'queued') return;
    try {
      const res = await apiFetch('/arena/matchmaking/quick/cancel', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena quick match cancel failed');
      setQuickMatch(data.data || null);
      toast('빠른대전 대기를 취소했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '빠른대전 취소에 실패했습니다.', 'error');
    }
  };

  const loadCupDetail = React.useCallback(async (cupId: string | null | undefined) => {
    if (!cupId) return;
    try {
      const res = await apiFetch(`/arena/cups/${cupId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLastCup(data.data || null);
    } catch (err) {
      console.warn('[ArenaTab] 컵 상세 로드 실패:', err);
    }
  }, []);

  const loadCupStatus = React.useCallback(async (showToast = false) => {
    if (!user || !season?.cup_enabled) return;
    try {
      const res = await apiFetch('/arena/cups/queue/status');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena cup status failed');
      const next = data.data || null;
      setCupStatus(next);
      if (next?.status === 'matched') {
        notifyArenaQueueMatched('cup', next.cup_id);
        await loadCupDetail(next.cup_id);
        if (showToast) toast('8인 컵이 완료되었습니다.', 'success');
      }
    } catch (err: any) {
      if (showToast) toast(err?.message || '8인 컵 상태 조회에 실패했습니다.', 'error');
    }
  }, [loadCupDetail, notifyArenaQueueMatched, season?.cup_enabled, toast, user]);

  const startCup = async (deckId: string) => {
    if (!user || cupLoadingDeckId) return;
    if (!season?.cup_enabled) {
      toast('8인 컵은 현재 비활성화되어 있습니다.', 'warning');
      return;
    }
    setCupLoadingDeckId(deckId);
    setQueueModalDismissedFor(null);
    try {
      const res = await apiFetch('/arena/cups/join', {
        method: 'POST',
        body: JSON.stringify({ deck_id: deckId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.validation?.errors) ? data.validation.errors[0] : data.message;
        throw new Error(detail || 'Arena cup join failed');
      }
      const next = data.data || null;
      setCupStatus(next);
      if (next?.status === 'matched') {
        notifyArenaQueueMatched('cup', next.cup_id);
        await loadCupDetail(next.cup_id);
      }
      toast(next?.status === 'matched' ? '8인 컵이 완료되었습니다.' : '8인 컵 대기열에 등록했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '8인 컵 참가에 실패했습니다.', 'error');
    } finally {
      setCupLoadingDeckId(null);
    }
  };

  const cancelCup = async () => {
    if (!user || !season?.cup_enabled || cupStatus?.status !== 'queued') return;
    try {
      const res = await apiFetch('/arena/cups/cancel', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena cup cancel failed');
      setCupStatus(data.data || null);
      toast('8인 컵 대기를 취소했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '8인 컵 취소에 실패했습니다.', 'error');
    }
  };
  const startBotPractice = async (deckId: string) => {
    if (!user || botMatchLoadingDeckId) return;
    setBotMatchLoadingDeckId(deckId);
    try {
      const res = await apiFetch('/arena/bot-matches', {
        method: 'POST',
        body: JSON.stringify({ deck_id: deckId, difficulty: 'normal' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.validation?.errors) ? data.validation.errors[0] : data.message;
        throw new Error(detail || 'Arena bot match failed');
      }
      const match = data.data?.match || null;
      setSelectedReplayMatch(match);
      setRoundWait(null);
      setRoundReveal(null);
      setSelectedReplay(match?.id ? {
        match_id: match.id,
        match_format: 'best_of_five',
        rounds_to_win: 3,
        replay_storage: 'tick_events',
        rounds: []
      } as ArenaReplay : null);
      const nextPlan = match?.summary?.player_deck?.round_plans?.find((plan: any) => plan.round_no === 1) || match?.summary?.player_deck?.round_plans?.[0];
      setRoundCommitTactic(nextPlan?.tactic_style || 'balanced');
      setRoundCommitFocus(nextPlan?.focus_rule || 'frontline_first');
      setRoundCommitChipId(match?.summary?.player_deck?.strategy_chip_id || 'none');
      toast('봇 연습전이 준비되었습니다. 1라운드 전술을 선택해 시작하세요.', 'success');
      if (match?.id) router.push(arenaMatchHref(match.id));
    } catch (err: any) {
      toast(err?.message || '봇 연습전 생성에 실패했습니다.', 'error');
    } finally {
      setBotMatchLoadingDeckId(null);
    }
  };

  const commitSelectedArenaRound = async (forceAutoCommit = false) => {
    if (!selectedReplayMatch?.id || roundCommitLoading) return;
    const nextRoundNo = selectedReplayMatch.summary?.current_round_no || selectedReplayMatch.round_count + 1;
    setRoundCommitLoading(true);
    setRoundReveal(null);
    if (roundRevealTimerRef.current !== null) {
      window.clearTimeout(roundRevealTimerRef.current);
      roundRevealTimerRef.current = null;
    }
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(selectedReplayMatch.id)}/rounds/commit`, {
        method: 'POST',
        body: JSON.stringify({
          round_no: nextRoundNo,
          tactic_style: roundCommitTactic,
          focus_rule: roundCommitFocus,
          strategy_chip_id: roundCommitChipId,
          auto_commit: forceAutoCommit || canForceRoundAfterWait
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena round commit failed');
      const match = data.data?.match || null;
      const replay = data.data?.replay || null;
      setSelectedReplayMatch(match);
      if (replay) setSelectedReplay(replay);
      if (data.data?.round_status?.status === 'waiting') {
        const deadlineAt = data.data.round_status.deadline_at || match?.summary?.pending_round_input?.deadline_at;
        if (deadlineAt) {
          setRoundWait({ roundNo: nextRoundNo, deadlineAt });
          setRoundWaitNow(Date.now());
          toast('상대의 라운드 선택을 잠시 기다립니다.', 'success');
        }
        return;
      }
      setRoundWait(null);
      const latestRound = [...(match?.summary?.round_results || [])].sort((a: any, b: any) => Number(b.round_no || 0) - Number(a.round_no || 0))[0];
      const roundWinner = latestRound?.winner_side || 'draw';
      const upcomingRoundNo = match?.summary?.current_round_no || (match?.round_count || nextRoundNo) + 1;
      const upcomingPlan = match?.summary?.player_deck?.round_plans?.find((plan: any) => plan.round_no === upcomingRoundNo)
        || match?.summary?.player_deck?.round_plans?.[0];
      setRoundCommitTactic(upcomingPlan?.tactic_style || roundCommitTactic);
      setRoundCommitFocus(upcomingPlan?.focus_rule || roundCommitFocus);
      setRoundCommitChipId(match?.summary?.player_deck?.strategy_chip_id || roundCommitChipId);
      const reveal: ArenaRoundReveal = {
        roundNo: nextRoundNo,
        stage: 'battle',
        roundWinner,
        completed: isArenaMatchCompleted(match),
        matchResult: isArenaMatchCompleted(match) ? (match?.result || 'draw') : null
      };
      setRoundReveal(reveal);
      roundRevealTimerRef.current = window.setTimeout(() => {
        setRoundReveal({ ...reveal, stage: 'result' });
        toast(reveal.completed
          ? reveal.matchResult === 'win' ? '세트 승리로 전투를 마쳤습니다.' : reveal.matchResult === 'loss' ? '세트 패배로 전투를 마쳤습니다.' : '무승부로 전투를 마쳤습니다.'
          : `${reveal.roundNo}라운드가 끝났습니다. 다음 라운드 전술을 조정하세요.`,
          'success'
        );
        roundRevealTimerRef.current = null;
      }, 2200);
    } catch (err: any) {
      toast(err?.message || '라운드 확정에 실패했습니다.', 'error');
    } finally {
      setRoundCommitLoading(false);
    }
  };

  const loadSpectatorReplay = async () => {
    const rawShare = spectatorShareToken.trim();
    if (!rawShare || spectatorLoading) return;
    const token = rawShare.includes('share=')
      ? new URLSearchParams(rawShare.split('?')[1] || rawShare).get('share') || rawShare
      : rawShare;
    setSpectatorLoading(true);
    setSpectatorError(null);
    try {
      const res = await apiFetch(`/arena/spectator/share/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '관전 리플레이를 찾을 수 없습니다.');
      setSpectatorReplay(data.data || null);
      toast('관전 리플레이를 불러왔습니다.', 'success');
    } catch (err: any) {
      setSpectatorReplay(null);
      setSpectatorError(err?.message || '관전 리플레이를 불러오지 못했습니다.');
      toast(err?.message || '관전 리플레이를 불러오지 못했습니다.', 'error');
    } finally {
      setSpectatorLoading(false);
    }
  };

  const createArenaShareLink = async (matchId: string) => {
    if (!matchId || shareLoadingMatchId) return;
    setShareLoadingMatchId(matchId);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(matchId)}/share`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '관전 공유 링크를 만들지 못했습니다.');
      const token = data.data?.token;
      const url = token ? `${window.location.origin}/arena/spectate?share=${encodeURIComponent(token)}` : '';
      if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
      toast(url ? '관전 공유 링크를 복사했습니다.' : '관전 공유 링크를 만들었습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '관전 공유 링크 생성에 실패했습니다.', 'error');
    } finally {
      setShareLoadingMatchId(null);
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) return;
    router.replace(`/arena/spectate?share=${encodeURIComponent(token)}`);
  }, [router]);

  const loadRecentMatchReplay = async (match: ArenaRecentMatch) => {
    try {
      if (isArenaMatchInProgress(match)) {
        router.push(arenaMatchHref(match.id));
        setSelectedReplayMatch(match);
        setRoundWait(match.summary?.pending_round_input?.deadline_at ? {
          roundNo: match.summary.pending_round_input.round_no,
          deadlineAt: match.summary.pending_round_input.deadline_at
        } : null);
        setRoundReveal(null);
        setSelectedReplay({
          match_id: match.id,
          match_format: 'best_of_five',
          rounds_to_win: 3,
          replay_storage: 'tick_events',
          rounds: []
        } as ArenaReplay);
        const nextRoundNo = match.summary?.current_round_no || match.round_count + 1;
        const nextPlan = match.summary?.player_deck?.round_plans?.find((plan) => plan.round_no === nextRoundNo) || match.summary?.player_deck?.round_plans?.[0];
        setRoundCommitTactic(nextPlan?.tactic_style || 'balanced');
        setRoundCommitFocus(nextPlan?.focus_rule || 'frontline_first');
        setRoundCommitChipId(match.summary?.player_deck?.strategy_chip_id || 'none');
        toast('진행 중인 매치를 불러왔습니다.', 'success');
        return;
      }
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/replay`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '리플레이를 불러오지 못했습니다.');
      setSelectedReplayMatch(match);
      setSelectedReplay(data.data || null);
      toast('최근 경기 리플레이를 불러왔습니다.', 'success');
      router.push(arenaMatchHref(match.id));
    } catch (err: any) {
      toast(err?.message || '최근 경기 리플레이를 불러오지 못했습니다.', 'error');
    }
  };

  const loadMyArenaCosmetics = React.useCallback(async (force = false) => {
    if (!user) {
      setArenaShopItems([]);
      setArenaCosmeticOwned({});
      setArenaCosmeticPurchases({});
      setArenaCosmeticLoadout(null);
      arenaCosmeticsLoadedAtRef.current = 0;
      return;
    }
    if (!force && arenaCosmeticsLoadedAtRef.current && Date.now() - arenaCosmeticsLoadedAtRef.current < 30_000) return;
    if (arenaCosmeticsLoadPromiseRef.current) return arenaCosmeticsLoadPromiseRef.current;

    const request = (async () => {
      setArenaCosmeticsLoading(true);
      setArenaCosmeticsError(null);
      try {
        const [itemsRes, ownedRes, purchasesRes, loadoutRes] = await Promise.all([
          apiFetch('/arena/cosmetics/shop-items'),
          apiFetch('/arena/cosmetics/inventory-counts'),
          apiFetch('/arena/cosmetics/purchases'),
          apiFetch('/arena/cosmetics/loadout')
        ]);
        const [itemsData, ownedData, purchasesData, loadoutData] = await Promise.all([
          itemsRes.json().catch(() => ({})),
          ownedRes.json().catch(() => ({})),
          purchasesRes.json().catch(() => ({})),
          loadoutRes.json().catch(() => ({}))
        ]);
        if (!itemsRes.ok || !ownedRes.ok || !purchasesRes.ok || !loadoutRes.ok) {
          throw new Error(itemsData.message || ownedData.message || purchasesData.message || loadoutData.message || 'Arena cosmetics response was not ok');
        }
        setArenaShopItems(Array.isArray(itemsData.items) ? itemsData.items : []);
        setArenaCosmeticOwned(ownedData && typeof ownedData === 'object' ? ownedData : {});
        setArenaCosmeticPurchases(purchasesData && typeof purchasesData === 'object' ? purchasesData : {});
        setArenaCosmeticLoadout(loadoutData.data || null);
        arenaCosmeticsLoadedAtRef.current = Date.now();
      } catch (err: any) {
        console.warn('[ArenaTab] 아레나 코스메틱 로드 실패:', err);
        setArenaCosmeticsError(err?.message || '아레나 스타일 정보를 불러오지 못했습니다.');
      } finally {
        setArenaCosmeticsLoading(false);
        arenaCosmeticsLoadPromiseRef.current = null;
      }
    })();
    arenaCosmeticsLoadPromiseRef.current = request;
    return request;
  }, [user]);

  const buyArenaCosmetic = async (item: ArenaShopItem) => {
    if (!user || arenaCosmeticBuyingId !== null) return;
    const saleState = getArenaShopSaleState(item);
    if (saleState.notStarted) { toast('아직 판매가 시작되지 않은 아레나 아이템입니다.', 'warning'); return; }
    if (saleState.ended) { toast('판매 기간이 종료된 아레나 아이템입니다.', 'warning'); return; }
    if (saleState.totalSoldOut) { toast('준비된 한정 수량이 모두 판매되었습니다.', 'warning'); return; }
    const price = Math.max(0, Number(item.price || 0));
    if (user.point < price) { toast('포인트가 부족합니다.', 'warning'); return; }

    setArenaCosmeticBuyingId(item.id);
    updatePoints(-price);
    try {
      const res = await apiFetch('/arena/cosmetics/buy', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '아레나 아이템 구매에 실패했습니다.');
      toast(`'${item.name}' 아레나 아이템을 구매했습니다.`, 'success');
      await Promise.all([refreshUserData(), loadMyArenaCosmetics(true)]);
    } catch (err: any) {
      updatePoints(price);
      toast(err?.message || '아레나 아이템 구매에 실패했습니다.', 'error');
    } finally {
      setArenaCosmeticBuyingId(null);
    }
  };

  const equipArenaCosmetic = async (item: ArenaShopItem, nextItemId: number | null = item.id) => {
    if (!user || arenaCosmeticEquippingId !== null) return;
    setArenaCosmeticEquippingId(item.id);
    try {
      const body = (() => {
        if (item.type === 'border') return { border_item_id: nextItemId };
        if (item.type === 'name_effect') return { name_effect_item_id: nextItemId };
        const currentSlot = arenaEmoteSlots.find((slot) => arenaCosmeticLoadout?.[slot.key] === item.id);
        const emptySlot = arenaEmoteSlots.find((slot) => !arenaCosmeticLoadout?.[slot.key]);
        const targetSlot = nextItemId === null ? currentSlot || arenaEmoteSlots[0] : emptySlot || currentSlot || arenaEmoteSlots[0];
        return { [targetSlot.key]: nextItemId };
      })();
      const res = await apiFetch('/arena/cosmetics/loadout', {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '아레나 스타일 장착에 실패했습니다.');
      setArenaCosmeticLoadout(data.data || null);
      toast(nextItemId ? `'${item.name}'을 아레나에 장착했습니다.` : `'${item.name}'을 아레나에서 해제했습니다.`, 'success');
    } catch (err: any) {
      toast(err?.message || '아레나 스타일 장착에 실패했습니다.', 'error');
    } finally {
      setArenaCosmeticEquippingId(null);
    }
  };

  const setArenaEmoteSlot = async (slotKey: ArenaEmoteSlotKey, itemId: number | null) => {
    if (!user || arenaCosmeticEquippingId !== null) return;
    setArenaCosmeticEquippingId(itemId || -1);
    try {
      const res = await apiFetch('/arena/cosmetics/loadout', {
        method: 'PATCH',
        body: JSON.stringify({ [slotKey]: itemId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '아레나 이모트 배치에 실패했습니다.');
      setArenaCosmeticLoadout(data.data || null);
      toast(itemId ? '이모트 위치를 저장했습니다.' : '이모트 위치를 비웠습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '아레나 이모트 배치에 실패했습니다.', 'error');
    } finally {
      setArenaCosmeticEquippingId(null);
    }
  };

  React.useEffect(() => {
    if (arenaSiteTab !== 'play' && arenaSiteTab !== 'inventory') return;
    loadArenaPreview();
  }, [arenaSiteTab, loadArenaPreview]);

  React.useEffect(() => {
    if (!user) return;
    if (arenaSiteTab === 'play') {
      loadMyArenaStreamerCard();
      loadMyArenaDecks();
      loadMyOwnedArenaCards();
      loadMyRecentArenaMatches();
      loadArenaProfile();
      return;
    }
    if (arenaSiteTab === 'inventory') {
      loadMyArenaDecks();
      loadMyOwnedArenaCards();
      return;
    }
    if (arenaSiteTab === 'ranking') {
      loadArenaProfile();
    }
  }, [arenaSiteTab, loadArenaProfile, loadMyArenaDecks, loadMyArenaStreamerCard, loadMyOwnedArenaCards, loadMyRecentArenaMatches, user]);

  React.useEffect(() => {
    if (arenaSiteTab !== 'ranking') return;
    loadArenaRankings();
  }, [arenaSiteTab, loadArenaRankings]);

  React.useEffect(() => {
    if (arenaSiteTab !== 'style') return;
    loadMyArenaCosmetics();
  }, [arenaSiteTab, loadMyArenaCosmetics]);

  React.useEffect(() => {
    if (!user || arenaCosmeticLoadout || arenaCosmeticsLoading) return;
    if (!selectedReplay && !spectatorReplay) return;
    loadMyArenaCosmetics();
  }, [arenaCosmeticLoadout, arenaCosmeticsLoading, loadMyArenaCosmetics, selectedReplay, spectatorReplay, user]);

  React.useEffect(() => {
    if (!roundWait) return;
    setRoundWaitNow(Date.now());
    const timer = window.setInterval(() => setRoundWaitNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [roundWait?.deadlineAt, roundWait?.roundNo]);

  React.useEffect(() => () => {
    if (roundRevealTimerRef.current !== null) {
      window.clearTimeout(roundRevealTimerRef.current);
      roundRevealTimerRef.current = null;
    }
  }, []);


  React.useEffect(() => {
    if (!user || !season?.quick_match_enabled) return;
    if (quickMatch && quickMatch.status !== 'queued') return;

    let cancelled = false;
    const shouldStream = quickMatch?.status === 'queued';
    const source = shouldStream ? createArenaEventSource('/arena/matchmaking/quick/events') : null;
    if (!source) {
      void loadQuickMatchStatus();
    }
    const handleStatus = async (event: MessageEvent) => {
      if (cancelled) return;
      const next = JSON.parse(event.data || '{}');
      setQuickMatch(next);
      if (next?.status === 'matched' && next.match_id) {
        notifyArenaQueueMatched('quick', next.match_id);
        await openArenaMatchForRoundPlay(next.match_id);
        toast('빠른대전 매칭이 완료되었습니다. 1라운드 전술을 선택하세요.', 'success');
        source?.close();
      }
      if (next?.status && next.status !== 'queued') source?.close();
    };
    let fallbackTimer: number | null = null;
    let fallbackStarted = false;
    const scheduleFallback = () => {
      if (cancelled) return;
      fallbackTimer = window.setTimeout(async () => {
        await loadQuickMatchStatus(true);
        scheduleFallback();
      }, (quickMatch?.poll_after_sec || 8) * 1000);
    };
    const startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      scheduleFallback();
    };
    const handleStreamError = () => {
      source?.close();
      if (!cancelled && quickMatch?.status === 'queued') {
        void loadQuickMatchStatus(true);
        startFallback();
      }
    };
    source?.addEventListener('arena_queue_status', ((event: Event) => { void handleStatus(event as MessageEvent); }) as EventListener);
    source?.addEventListener('arena_queue_error', handleStreamError);
    source?.addEventListener('error', handleStreamError);

    if (!source && quickMatch?.status === 'queued') {
      startFallback();
    }

    return () => {
      cancelled = true;
      source?.close();
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [loadQuickMatchStatus, notifyArenaQueueMatched, openArenaMatchForRoundPlay, quickMatch?.poll_after_sec, quickMatch?.status, season?.quick_match_enabled, toast, user]);

  React.useEffect(() => {
    if (!user || !season?.cup_enabled) return;
    if (cupStatus && cupStatus.status !== 'queued') return;

    let cancelled = false;
    const shouldStream = cupStatus?.status === 'queued';
    const source = shouldStream ? createArenaEventSource('/arena/cups/queue/events') : null;
    if (!source) {
      void loadCupStatus();
    }
    const handleStatus = async (event: MessageEvent) => {
      if (cancelled) return;
      const next = JSON.parse(event.data || '{}');
      setCupStatus(next);
      if (next?.status === 'matched' && next.cup_id) {
        notifyArenaQueueMatched('cup', next.cup_id);
        await loadCupDetail(next.cup_id);
        toast('8인 컵 결과가 도착했습니다.', 'success');
        source?.close();
      }
      if (next?.status && next.status !== 'queued') source?.close();
    };
    let fallbackTimer: number | null = null;
    let fallbackStarted = false;
    const scheduleFallback = () => {
      if (cancelled) return;
      fallbackTimer = window.setTimeout(async () => {
        await loadCupStatus(true);
        scheduleFallback();
      }, (cupStatus?.poll_after_sec || 12) * 1000);
    };
    const startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      scheduleFallback();
    };
    const handleStreamError = () => {
      source?.close();
      if (!cancelled && cupStatus?.status === 'queued') {
        void loadCupStatus(true);
        startFallback();
      }
    };
    source?.addEventListener('arena_cup_status', ((event: Event) => { void handleStatus(event as MessageEvent); }) as EventListener);
    source?.addEventListener('arena_queue_error', handleStreamError);
    source?.addEventListener('error', handleStreamError);

    if (!source && cupStatus?.status === 'queued') {
      startFallback();
    }

    return () => {
      cancelled = true;
      source?.close();
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [cupStatus?.poll_after_sec, cupStatus?.status, loadCupDetail, loadCupStatus, notifyArenaQueueMatched, season?.cup_enabled, toast, user]);

  const targetPlayTime = formatSecondsRange(status?.match_format?.target_client_play_time_seconds);
  const deckEditorCardById = React.useMemo(() => {
    const map = new Map<string, ArenaCard>();
    ownedCards.forEach((card) => map.set(card.card_id, card));
    return map;
  }, [ownedCards]);
  const deckEditorSearchTerm = deckEditorSearch.trim().toLowerCase();
  const filteredDeckEditorCards = React.useMemo(() => {
    if (!deckEditorSearchTerm) return ownedCards;
    return ownedCards.filter((card) => {
      const haystack = [
        card.name,
        card.card_id,
        card.channel_id,
        card.class.name,
        card.class.role,
        roleLabels[card.class.role] || '',
        card.class.description,
        ...card.skills.flatMap((skill) => [skill.name, skill.type, skill.description, ...skill.tags])
      ].join(' ').toLowerCase();
      return haystack.includes(deckEditorSearchTerm);
    });
  }, [deckEditorSearchTerm, ownedCards]);
  const deckEditorMissingCount = Math.max(0, 6 - deckEditorCardIds.length);
  const tacticChipOptions = rulesCatalog?.tactic_chips || [];
  const battlefieldRules = rulesCatalog?.battlefield_rules || [];
  const streamerConfigOptions = myStreamerCard?.config_options;
  const streamerSelectedClassId = myStreamerCardDraft.class_id || myStreamerCard?.card?.class?.id || streamerConfigOptions?.classes?.[0]?.id || '';
  const streamerSkillOptions = streamerSelectedClassId ? streamerConfigOptions?.skills_by_class?.[streamerSelectedClassId] || [] : [];
  const streamerSelectedSkillIds = Array.isArray(myStreamerCardDraft.skill_ids) ? myStreamerCardDraft.skill_ids : [];
  const streamerSkillSlots = arenaSkillSlotTypes.map((type) => {
    const options = streamerSkillOptions.filter((skill) => skill.type === type);
    return {
      type,
      label: arenaSkillSlotLabels[type],
      options,
      selectedId: options.find((skill) => streamerSelectedSkillIds.includes(skill.id))?.id || options[0]?.id || ''
    };
  });
  const streamerSelectedTagIds = Array.isArray(myStreamerCardDraft.tag_ids) ? myStreamerCardDraft.tag_ids : [];
  const isRoundBattleRevealing = roundReveal?.stage === 'battle';
  const roundWaitRemainingMs = roundWait ? Math.max(0, new Date(roundWait.deadlineAt).getTime() - roundWaitNow) : 0;
  const roundWaitRemainingSec = Math.ceil(roundWaitRemainingMs / 1000);
  const canForceRoundAfterWait = Boolean(roundWait && roundWaitRemainingMs <= 0);

  React.useEffect(() => {
    if (!roundWait || !selectedReplayMatch?.id) return;
    if (isArenaMatchCompleted(selectedReplayMatch)) return;
    const key = `${selectedReplayMatch.id}:${roundWait.roundNo}:${roundWait.deadlineAt}`;
    const delay = Math.max(250, new Date(roundWait.deadlineAt).getTime() - Date.now() + 250);
    const timer = window.setTimeout(() => {
      if (autoRoundCommitKeyRef.current === key || roundCommitLoading || isRoundBattleRevealing) return;
      autoRoundCommitKeyRef.current = key;
      commitSelectedArenaRound(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    roundWait?.deadlineAt,
    roundWait?.roundNo,
    roundCommitLoading,
    isRoundBattleRevealing,
    selectedReplayMatch?.id,
    selectedReplayMatch?.summary?.progress_status
  ]);

  const selectedMatchResultLabel = isArenaMatchInProgress(selectedReplayMatch)
    ? `${selectedReplayMatch?.summary?.current_round_no || (selectedReplayMatch?.round_count || 0) + 1}라운드 선택 대기`
    : getArenaMatchResultLabel(selectedReplayMatch);
  const roundRevealResultLabel = roundReveal?.roundWinner === 'player' ? '라운드 승리' : roundReveal?.roundWinner === 'bot' ? '라운드 패배' : '라운드 무승부';
  const isArenaAdmin = user?.role === 'ADMIN';
  const playPreviewCards = React.useMemo(() => (
    user ? pickRandomArenaCards(ownedCards) : pickRandomArenaCards(cards)
  ), [cards, ownedCards, user]);
  const displayedCards = playPreviewCards;
  const hasArenaCards = displayedCards.length > 0;
  const playCardPoolLoading = user ? ownedCardsLoading && ownedCards.length === 0 : loading && cards.length === 0;
  const playCardPoolError = user ? ownedCardsError : previewError;
  const reloadPlayCardPool = user ? loadMyOwnedArenaCards : loadArenaPreview;
  const primaryCtaLabel = user
    ? hasArenaCards ? '내 덱 준비하기' : '카드 풀 보기'
    : '로그인하기';
  const scrollToPreview = () => {
    previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const statusItems = [
    ['빠른대전', Boolean(season?.quick_match_enabled)],
    ['AI 봇 연습', Boolean(season?.bot_practice_enabled)],
    ['MMR', Boolean(season?.mmr_enabled)],
    ['랭킹', Boolean(season?.ranking_enabled)],
    ['8인 컵', Boolean(season?.cup_enabled)],
    ['관전 리플레이', true]
  ] as const;
  const equippedArenaEmotes = React.useMemo(() => getArenaEmoteItems(arenaCosmeticLoadout), [arenaCosmeticLoadout]);
  const ownedArenaEmoteItems = React.useMemo(() => (
    arenaShopItems.filter((item) => item.type === 'emote' && Number(arenaCosmeticOwned[item.id] || 0) > 0)
  ), [arenaCosmeticOwned, arenaShopItems]);
  const isArenaCosmeticEquipped = React.useCallback((item: ArenaShopItem) => {
    if (item.type === 'border') return arenaCosmeticLoadout?.border_item_id === item.id;
    if (item.type === 'name_effect') return arenaCosmeticLoadout?.name_effect_item_id === item.id;
    return equippedArenaEmotes.some((entry) => entry.item.id === item.id);
  }, [arenaCosmeticLoadout, equippedArenaEmotes]);
  const filteredArenaShopItems = React.useMemo(() => (
    arenaShopItems.filter((item) => arenaStyleFilter === 'all' || item.type === arenaStyleFilter)
  ), [arenaShopItems, arenaStyleFilter]);
  const rankingItems = rankings?.items || [];
  const rankingTopThree = rankingItems.slice(0, 3);
  const rankingTierGroups = React.useMemo(() => {
    const order = ['MASTER', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'];
    const counts = new Map<string, number>();
    rankingItems.forEach((item) => {
      const tier = String(item.tier || 'BRONZE').toUpperCase();
      counts.set(tier, (counts.get(tier) || 0) + 1);
    });
    return order
      .map((tier) => ({ tier, count: counts.get(tier) || 0 }))
      .filter((item) => item.count > 0);
  }, [rankingItems]);
  const rankingMmrBands = React.useMemo(() => {
    const bands = [
      { id: 'master', label: '2000+', min: 2000, max: Infinity },
      { id: 'diamond', label: '1800-1999', min: 1800, max: 1999 },
      { id: 'platinum', label: '1600-1799', min: 1600, max: 1799 },
      { id: 'gold', label: '1400-1599', min: 1400, max: 1599 },
      { id: 'silver', label: '1200-1399', min: 1200, max: 1399 },
      { id: 'bronze', label: '~1199', min: -Infinity, max: 1199 }
    ];
    return bands.map((band) => ({
      ...band,
      count: rankingItems.filter((item) => item.rating >= band.min && item.rating <= band.max).length
    })).filter((band) => band.count > 0);
  }, [rankingItems]);
  const rankingAverageMmr = rankingItems.length
    ? Math.round(rankingItems.reduce((total, item) => total + item.rating, 0) / rankingItems.length)
    : 0;
  const rankingBestWinRate = rankingItems
    .filter((item) => item.wins + item.losses >= 3)
    .map((item) => ({
      ...item,
      winRate: Math.round((item.wins / Math.max(1, item.wins + item.losses)) * 1000) / 10
    }))
    .sort((a, b) => b.winRate - a.winRate || b.rating - a.rating)
    .slice(0, 5);

  const validDecks = decks.filter((deck) => deck.validation_status === 'VALID');
  const previewDecks = validDecks.slice(0, 3);
  const hasValidDeck = validDecks.length > 0;
  const quickQueueActive = quickMatch?.status === 'queued';
  const cupQueueActive = cupStatus?.status === 'queued';
  const activeQueueModal = quickQueueActive ? {
    key: `quick:${quickMatch?.queue_ticket_id || 'active'}`,
    Icon: Swords,
    label: '빠른대전 매칭 중',
    title: '가까운 MMR 상대를 찾고 있습니다',
    description: '상대가 잡히면 라운드 전술 선택 화면으로 바로 이어집니다.',
    elapsedLabel: formatQueueDuration(quickMatch?.elapsed_sec),
    progressLabel: '1:1 랭크 큐',
    estimateLabel: getQuickQueueEstimate(quickMatch?.elapsed_sec),
    onCancel: cancelQuickMatch,
    toneClass: 'from-rose-50 via-white to-red-50 border-rose-200 text-rose-700 dark:from-rose-300/12 dark:via-white/5 dark:to-red-300/10 dark:border-rose-300/20 dark:text-rose-100'
  } : cupQueueActive ? {
    key: `cup:${cupStatus?.queue_ticket_id || 'active'}`,
    Icon: Trophy,
    label: '8인 컵 대기 중',
    title: `${cupStatus?.queued_count || 1}/${cupStatus?.required_count || 8}명 참가 대기`,
    description: '8명이 모이면 컵 브래킷이 자동으로 확정되고 결과가 정리됩니다.',
    elapsedLabel: formatQueueDuration(cupStatus?.elapsed_sec),
    progressLabel: `${Math.max(1, Number(cupStatus?.queued_count || 1))}/${Math.max(1, Number(cupStatus?.required_count || 8))}명`,
    estimateLabel: getCupQueueEstimate(cupStatus?.queued_count, cupStatus?.required_count),
    onCancel: cancelCup,
    toneClass: 'from-red-50 via-white to-rose-50 border-red-200 text-red-700 dark:from-red-300/12 dark:via-white/5 dark:to-rose-300/10 dark:border-red-300/20 dark:text-red-100'
  } : null;
  const ActiveQueueIcon = activeQueueModal?.Icon || Clock3;
  const showQueueModal = Boolean(activeQueueModal && queueModalDismissedFor !== activeQueueModal.key);
  const arenaQueueModes = [
    {
      id: 'bot',
      Icon: Bot,
      title: 'AI 봇 연습전',
      badge: '즉시 시작',
      description: '상대를 기다리지 않고 라운드 전술과 덱 흐름을 확인합니다.',
      queueLabel: '대기열 없음',
      estimate: '대기 없이 바로 매치를 생성합니다.',
      enabled: Boolean(season?.bot_practice_enabled),
      disabledLabel: '봇전 비활성화',
      loadingDeckId: botMatchLoadingDeckId,
      onStart: startBotPractice,
      tone: 'border-primary/20 bg-primary/8 text-primary dark:bg-primary/12'
    },
    {
      id: 'quick',
      Icon: Swords,
      title: '빠른대전',
      badge: '1:1 MMR',
      description: '비슷한 MMR의 상대를 찾아 5판 3선승으로 진행합니다.',
      queueLabel: '빠른대전 대기열',
      estimate: quickQueueActive ? getQuickQueueEstimate(quickMatch?.elapsed_sec) : '대기 중에는 MMR 범위를 단계적으로 넓힙니다.',
      enabled: Boolean(season?.quick_match_enabled),
      disabledLabel: '빠른대전 비활성화',
      loadingDeckId: quickMatchLoadingDeckId,
      onStart: startQuickMatch,
      tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100'
    },
    {
      id: 'cup',
      Icon: Trophy,
      title: '8인 컵',
      badge: '별도 컵 큐',
      description: '8명이 모이면 브래킷을 만들고 등수별 결과를 정리합니다.',
      queueLabel: '8인 컵 대기열',
      estimate: cupQueueActive ? getCupQueueEstimate(cupStatus?.queued_count, cupStatus?.required_count) : '8명이 모여야 시작하므로 빠른대전보다 오래 걸릴 수 있습니다.',
      enabled: Boolean(season?.cup_enabled),
      disabledLabel: '8인 컵 비활성화',
      loadingDeckId: cupLoadingDeckId,
      onStart: startCup,
      tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100'
    }
  ];
  return (
    <div className="arena-page-shell space-y-6">
      {arenaSiteTab === 'play' ? (
        <>
      <section className="arena-hero-surface cute-surface overflow-hidden rounded-[2rem] border-white/70 p-4 dark:border-white/10 md:p-7">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.28fr)_minmax(19rem,0.82fr)]">
          <div className="arena-hero-copy min-w-0">
            <div className="arena-hero-brand flex flex-wrap items-center gap-3">
              <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                <Swords className="h-3.5 w-3.5" />
                치카포 아레나
              </span>
              <span className="arena-hero-chip rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100">
                라운드 전술
              </span>
            </div>
            <div className="arena-hero-title-wrap mt-4 max-w-3xl rounded-[1.75rem] px-1 py-1 sm:px-2">
              <h1 className="arena-hero-title text-[2rem] font-black leading-[1.16] tracking-normal sm:text-4xl md:text-5xl">
                좋아하는 스트리머 카드가<br />한 판의 주인공이 되는 아레나
              </h1>
            </div>
            <p className="arena-hero-lead mt-3 max-w-2xl text-sm font-bold leading-relaxed text-muted-foreground md:text-[0.95rem]">
              응원하던 카드로 팀을 짜고, 전열과 후열, 라운드별 플랜이 맞물리는 순간을 지켜보세요.<br />
              비싼 카드보다 마음에 드는 조합과 다음 라운드의 반전이 더 기억에 남는 5판 3선승 승부를 지향합니다.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => user ? scrollToPreview() : router.push('/login')}
                className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20"
              >
                <Zap className="h-4 w-4" />
                {primaryCtaLabel}
              </button>
              <button
                type="button"
                onClick={scrollToPreview}
                className="arena-secondary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-xs font-black text-foreground shadow-sm"
              >
                <Bot className="h-4 w-4" />
                {hasArenaCards ? '카드 조합 보기' : '카드 풀 보기'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/arena/inventory')}
                className="arena-secondary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-xs font-black text-foreground shadow-sm"
              >
                <Layers3 className="h-4 w-4" />
                보유 카드 보기
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {['덱 편성', '5판 3선승', '라운드 전술', '리플레이'].map((item) => (
                <span key={item} className="arena-hero-tag rounded-full border border-white/70 bg-white/72 px-3 py-1 text-[10px] font-black text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/10">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <ArenaBattleShowcase cards={displayedCards} />
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Swords, label: '매치 방식', value: '5판 3선승' },
            { icon: Clock3, label: '예상 플레이 시간', value: targetPlayTime },
            { icon: ShieldCheck, label: '주요 전략 요소', value: '덱 조합/라운드 선택' }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="arena-metric-tile arena-hero-metric flex items-center gap-3 rounded-3xl border border-white/70 bg-white/78 p-4 shadow-sm dark:border-white/10 dark:bg-card/70">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-muted-foreground">{item.label}</p>
                  <p className="mt-0.5 text-lg font-black text-foreground">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="arena-next-step cute-surface rounded-[2rem] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-primary">다음 행동</p>
            <h2 className="mt-1 text-base font-black text-foreground">
              {!user
                ? '로그인하고 내 카드로 첫 덱을 준비하세요'
                : !hasArenaCards
                  ? '아레나에 어울리는 첫 조합을 기다려보세요'
                  : decks.length === 0
                    ? '첫 덱을 만들고 대전에서 라운드 선택을 시작하세요'
                    : recentMatches.length === 0
                      ? '봇 연습전으로 첫 전투 흐름을 확인하세요'
                      : '최근 경기 하이라이트를 보고 다음 전술을 다듬으세요'}
            </h2>
            <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">
              {!user
                ? '아레나는 보유 카드와 저장 덱을 기준으로 진행됩니다.'
                : decks.length === 0
                  ? '보유 카드의 역할과 스킬을 살펴보며 내 덱의 색깔을 정해보세요.'
                  : '지난 경기를 다시 보며 카드별 활약과 라운드 흐름을 확인할 수 있습니다.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!user ? (
              <button type="button" onClick={() => router.push('/login')} className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground">
                <Zap className="h-4 w-4" />
                로그인하기
              </button>
            ) : decks.length === 0 ? (
              <button type="button" onClick={createStarterDeck} disabled={deckActionLoading || ownedCards.length < 6} className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50">
                <PlusCircle className="h-4 w-4" />
                첫 덱 만들기
              </button>
            ) : (
              <button type="button" onClick={() => startBotPractice(decks[0].id)} disabled={Boolean(botMatchLoadingDeckId) || decks[0].validation_status !== 'VALID'} className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50">
                <Bot className="h-4 w-4" />
                봇 연습 시작
              </button>
            )}
            <button type="button" onClick={scrollToPreview} className="arena-secondary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-xs font-black text-foreground">
              <Target className="h-4 w-4" />
              전술 보기
            </button>
          </div>
        </div>
      </section>

      <section className="arena-panel-soft cute-surface rounded-[2rem] p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
              <Swords className="h-3.5 w-3.5" />
              대전 큐 선택
            </span>
            <h2 className="mt-3 text-2xl font-black text-foreground md:text-3xl">원하는 방식으로 아레나를 시작하세요</h2>
            <p className="mt-2 max-w-2xl text-xs font-bold leading-relaxed text-muted-foreground">
              봇전은 큐 없이 즉시 생성되고, 빠른대전과 8인 컵은 서로 다른 대기열을 사용합니다. 대기 중에는 연결을 유지해 결과를 바로 받습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={loadMyArenaDecks}
            disabled={!user || deckLoading}
            className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${deckLoading ? 'animate-spin' : ''}`} />
            덱 새로고침
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {arenaQueueModes.map((mode) => {
            const Icon = mode.Icon;
            const isModeQueued = (mode.id === 'quick' && quickQueueActive) || (mode.id === 'cup' && cupQueueActive);
            return (
              <article key={mode.id} className="arena-status-row flex min-h-[20rem] flex-col rounded-3xl border border-border bg-card/72 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${mode.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-black ${mode.tone}`}>{mode.badge}</span>
                </div>
                <div className="mt-4 min-w-0">
                  <h3 className="text-lg font-black text-foreground">{mode.title}</h3>
                  <p className="mt-2 min-h-[2.5rem] text-xs font-bold leading-relaxed text-muted-foreground">{mode.description}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black">
                  <span className="rounded-2xl bg-secondary/55 px-3 py-2 text-muted-foreground">{mode.queueLabel}</span>
                  <span className={`rounded-2xl px-3 py-2 ${isModeQueued ? mode.tone : 'bg-secondary/55 text-muted-foreground'}`}>
                    {isModeQueued ? '대기 중' : mode.enabled ? '준비됨' : mode.disabledLabel}
                  </span>
                </div>
                <p className="mt-3 text-[11px] font-bold leading-relaxed text-muted-foreground">{mode.estimate}</p>
                <div className="mt-auto pt-4">
                  {!user ? (
                    <button type="button" onClick={() => router.push('/login')} className="arena-primary-cta cute-wiggle-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground">
                      <Zap className="h-4 w-4" />
                      로그인하고 시작
                    </button>
                  ) : deckLoading ? (
                    <div className="h-10 animate-pulse rounded-2xl bg-secondary/70" />
                  ) : decks.length === 0 ? (
                    <button type="button" onClick={createStarterDeck} disabled={deckActionLoading || ownedCards.length < 6} className="arena-primary-cta cute-wiggle-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50">
                      <PlusCircle className="h-4 w-4" />
                      첫 덱 만들기
                    </button>
                  ) : !hasValidDeck ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
                      검증 완료 덱이 필요합니다.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {previewDecks.map((deck) => (
                        <button
                          key={`${mode.id}-${deck.id}`}
                          type="button"
                          onClick={() => mode.onStart(deck.id)}
                          disabled={!mode.enabled || Boolean(mode.loadingDeckId)}
                          className="cute-wiggle-hover flex items-center justify-between gap-2 rounded-2xl border border-border bg-secondary/55 px-3 py-2 text-left text-[11px] font-black text-foreground disabled:opacity-50"
                        >
                          <span className="min-w-0 truncate">{deck.name}</span>
                          <span className="shrink-0 text-muted-foreground">{mode.loadingDeckId === deck.id ? '등록 중' : '시작'}</span>
                        </button>
                      ))}
                      {validDecks.length > previewDecks.length ? (
                        <p className="text-center text-[10px] font-bold text-muted-foreground">나머지 덱은 아래 저장 덱 목록에서 선택할 수 있습니다.</p>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>        </>
      ) : null}

      {!hideSiteTabs ? (
        <div className="cute-surface flex flex-wrap gap-2 rounded-[2rem] p-2">
          {([
            ['play', '아레나 플레이', Swords],
            ['inventory', '아레나 보관함', Layers],
            ['ranking', 'MMR 랭킹', Trophy],
            ['style', '아레나 스타일', Store],
            ...(isArenaAdmin ? [['admin', '아레나 관리자', ShieldCheck]] as const : [])
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setArenaSiteTab(id as ArenaSiteTab)}
              className={`cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                arenaSiteTab === id
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {arenaSiteTab === 'admin' && isArenaAdmin ? (
        <ArenaAdminPanel />
      ) : arenaSiteTab === 'inventory' ? (
        <section className="space-y-4">
          <div className="arena-panel-soft cute-surface overflow-hidden rounded-[2rem] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                  <Layers className="h-3.5 w-3.5" />
                  아레나 보관함
                </span>
                <h2 className="mt-3 text-2xl font-black text-foreground md:text-3xl">내 아레나 카드</h2>
                <p className="mt-2 max-w-2xl text-xs font-bold leading-relaxed text-muted-foreground">
                  치카포 보유 카드 중 아레나에 사용할 수 있는 카드만 아레나 규칙으로 다시 보여줍니다. 클래스, 스탯, 스킬, 태그를 확인하고 덱 후보를 고르세요.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadMyOwnedArenaCards}
                  disabled={!user || ownedCardsLoading}
                  className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${ownedCardsLoading ? 'animate-spin' : ''}`} />
                  보관함 새로고침
                </button>
                {user && decks.length === 0 ? (
                  <button
                    type="button"
                    onClick={createStarterDeck}
                    disabled={deckActionLoading || ownedCards.length < 6}
                    className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    <PlusCircle className="h-4 w-4" />
                    첫 덱 만들기
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['아레나 카드', user ? `${ownedCards.length.toLocaleString()}장` : '로그인 필요'],
                ['저장 덱', user ? `${decks.length.toLocaleString()}개` : '-'],
                ['최고 별', ownedCards.length ? `${Math.max(...ownedCards.map((card) => Number(card.max_star || 0)))}성` : '-'],
                ['보유 수량', ownedCards.length ? `${ownedCards.reduce((total, card) => total + Number(card.owned_count || 1), 0).toLocaleString()}장` : '-']
              ].map(([label, value]) => (
                <div key={label} className="arena-metric-tile rounded-3xl border border-white/70 bg-white/72 p-4 shadow-sm dark:border-white/10 dark:bg-card/70">
                  <p className="text-[10px] font-black text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-black text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {!user ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <ArenaStateNotice title="로그인이 필요합니다" description="로그인하면 보유 중인 카드를 아레나 규칙으로 변환한 보관함을 확인할 수 있습니다." />
            </div>
          ) : ownedCardsLoading && ownedCards.length === 0 ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm font-black text-foreground">아레나 보관함을 확인하는 중입니다</p>
              </div>
              <ArenaCardSkeletonGrid />
            </div>
          ) : ownedCardsError ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <ArenaStateNotice
                variant="error"
                title="아레나 보관함을 불러오지 못했습니다"
                description={ownedCardsError}
                actionLabel="다시 확인"
                onAction={loadMyOwnedArenaCards}
                disabled={ownedCardsLoading}
              />
            </div>
          ) : ownedCards.length === 0 ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <ArenaStateNotice
                title="아레나에서 사용할 보유 카드가 없습니다"
                description="치카포에서 보유한 스트리머 카드 중 아레나 카드로 변환 가능한 카드가 생기면 이곳에 표시됩니다."
              />
            </div>
          ) : (
            <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-black text-foreground">
                      <Layers3 className="h-5 w-5 text-primary" />
                      보유 카드 목록
                    </h3>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      아레나 전투에 쓰이는 능력치 기준으로 표시됩니다.
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">
                    {ownedCards.length.toLocaleString()}개
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {ownedCards.map((card) => (
                    <article key={card.card_id} className="arena-status-row overflow-hidden rounded-[1.5rem] border border-border bg-card/74 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30">
                      <div className={`bg-gradient-to-br ${roleToneClass[card.class.role] || roleToneClass.frontline} p-3`}>
                        <div className="flex items-center gap-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/80 shadow-sm dark:bg-white/10">
                            {card.image_url ? <img src={card.image_url} alt={card.name} className="h-full w-full object-cover" loading="lazy" /> : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-foreground">{card.name}</p>
                            <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                              <ArenaClassTooltip cardClass={card.class}>
                                <span>{card.class.name}</span>
                              </ArenaClassTooltip>
                              <span> · </span>
                              <ArenaRoleTooltip role={card.class.role}>
                                <span>{roleLabels[card.class.role] || card.class.role}</span>
                              </ArenaRoleTooltip>
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <span className="rounded-full bg-white/74 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-white/10">보유 {card.owned_count || 1}</span>
                              <span className="rounded-full bg-white/74 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-white/10">최고 {card.max_star || 0}성</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="grid grid-cols-5 gap-1.5">
                          {[
                            ['HP', card.stats.hp, 'hp'],
                            ['ATK', card.stats.attack, 'attack'],
                            ['DEF', card.stats.defense, 'defense'],
                            ['SPD', card.stats.speed, 'speed'],
                            ['FOC', card.stats.focus, 'focus']
                          ].map(([label, value, statKey]) => (
                            <ArenaStatTooltip key={String(label)} statKey={statKey as keyof ArenaCard['stats']} label={String(label)} value={Number(value)} className="block">
                              <span className="block rounded-2xl bg-secondary/52 px-2 py-1.5 text-center">
                                <span className="block text-[8px] font-black text-muted-foreground">{label}</span>
                                <span className="mt-0.5 block text-[11px] font-black text-foreground">{value}</span>
                              </span>
                            </ArenaStatTooltip>
                          ))}
                        </div>
                        <ArenaSkillList skills={card.skills} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <aside className="space-y-4">
                <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                  <h3 className="text-base font-black text-foreground">덱 준비 상태</h3>
                  <div className="mt-4 space-y-2">
                    <div className="arena-status-row flex items-center justify-between rounded-2xl border border-border bg-card/70 px-3 py-2">
                      <span className="text-xs font-black text-muted-foreground">최소 필요</span>
                      <span className="text-xs font-black text-foreground">{ownedCards.length >= 6 ? '충족' : `${Math.max(0, 6 - ownedCards.length)}장 부족`}</span>
                    </div>
                    <div className="arena-status-row flex items-center justify-between rounded-2xl border border-border bg-card/70 px-3 py-2">
                      <span className="text-xs font-black text-muted-foreground">저장 덱</span>
                      <span className="text-xs font-black text-foreground">{decks.length}개</span>
                    </div>
                    <StatBar label="보관함 준비도" value={Math.min(100, Math.round((ownedCards.length / 10) * 100))} />
                  </div>
                </div>

                <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                  <h3 className="text-base font-black text-foreground">클래스 분포</h3>
                  <div className="mt-4 space-y-2">
                    {Array.from(ownedCards.reduce((map, card) => {
                      map.set(card.class.name, (map.get(card.class.name) || 0) + 1);
                      return map;
                    }, new Map<string, number>())).map(([name, count]) => (
                      <div key={name} className="arena-status-row flex items-center justify-between rounded-2xl border border-border bg-card/70 px-3 py-2">
                        <span className="text-xs font-black text-muted-foreground">{name}</span>
                        <span className="text-xs font-black text-foreground">{count}장</span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </section>
          )}
        </section>
      ) : arenaSiteTab === 'ranking' ? (
        <section className="space-y-4">
          <div className="arena-panel-soft cute-surface overflow-hidden rounded-[2rem] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                  <Trophy className="h-3.5 w-3.5" />
                  MMR 랭킹
                </span>
                <h2 className="mt-3 text-2xl font-black text-foreground md:text-3xl">아레나 시즌 랭킹</h2>
                <p className="mt-2 max-w-2xl text-xs font-bold leading-relaxed text-muted-foreground">
                  빠른대전으로 쌓인 시즌 MMR을 기준으로 순위를 나눠 보여줍니다. 봇 연습전, 8인 컵, 코스메틱은 기본 랭크 MMR에 반영되지 않습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {user && profile ? (
                  <button
                    type="button"
                    onClick={() => openArenaProfileCard(profile.user_id)}
                    disabled={profileCardLoadingId === profile.user_id}
                    className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    <Activity className="h-4 w-4" />
                    내 전적 명함
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    loadArenaProfile();
                    loadArenaRankings();
                  }}
                  className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground"
                >
                  <RefreshCw className={`h-4 w-4 ${rankingsLoading || profileLoading ? 'animate-spin' : ''}`} />
                  랭킹 새로고침
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['내 순위', user ? profile?.rank ? `${profile.rank}위` : '집계 대기' : '로그인 필요'],
                ['내 MMR', user && profile ? profile.rating.toLocaleString() : '-'],
                ['랭킹 표본', `${rankingItems.length.toLocaleString()}명`],
                ['평균 MMR', rankingAverageMmr ? rankingAverageMmr.toLocaleString() : '-']
              ].map(([label, value]) => (
                <div key={label} className="arena-metric-tile rounded-3xl border border-white/70 bg-white/72 p-4 shadow-sm dark:border-white/10 dark:bg-card/70">
                  <p className="text-[10px] font-black text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-black text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {rankingsLoading && !rankings ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="mb-4 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm font-black text-foreground">MMR 랭킹을 확인하는 중입니다</p>
              </div>
              <ArenaListSkeleton rows={8} />
            </div>
          ) : rankingsError ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <ArenaStateNotice
                variant="error"
                title="랭킹을 불러오지 못했습니다"
                description={rankingsError}
                actionLabel="다시 확인"
                onAction={loadArenaRankings}
                disabled={rankingsLoading}
              />
            </div>
          ) : rankingItems.length === 0 ? (
            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <ArenaStateNotice title="아직 표시할 MMR 랭킹이 없습니다" description="빠른대전 기록이 쌓이면 이곳에 시즌 순위가 표시됩니다." />
            </div>
          ) : (
            <>
              <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-black text-foreground">
                        <Trophy className="h-5 w-5 text-primary" />
                        시즌 MMR 순위
                      </h3>
                      <p className="mt-1 text-xs font-bold text-muted-foreground">
                        상위 {rankingItems.length.toLocaleString()}명 기준 · 갱신 {rankings?.updated_at ? formatDateTime(rankings.updated_at) : '-'}
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">
                      {rankings?.source === 'rank_snapshot' ? '스냅샷' : '제한 조회'}
                    </span>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-border bg-card/64">
                    <div className="hidden grid-cols-[4.5rem_minmax(0,1fr)_8rem_7rem_7rem] gap-3 border-b border-border bg-secondary/45 px-4 py-3 text-[10px] font-black text-muted-foreground md:grid">
                      <span>순위</span>
                      <span>유저</span>
                      <span className="text-right">MMR</span>
                      <span className="text-right">티어</span>
                      <span className="text-right">전적</span>
                    </div>
                    <div className="divide-y divide-border/70">
                      {rankingItems.map((item) => {
                        const decided = item.wins + item.losses;
                        const winRate = decided > 0 ? Math.round((item.wins / decided) * 1000) / 10 : 0;
                        return (
                          <button
                            key={`${item.rank}-${item.user_id}`}
                            type="button"
                            onClick={() => openArenaProfileCard(item.user_id)}
                            disabled={profileCardLoadingId === item.user_id}
                            className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-primary/5 disabled:opacity-60 md:grid-cols-[4.5rem_minmax(0,1fr)_8rem_7rem_7rem] md:items-center"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`flex h-9 w-9 items-center justify-center rounded-2xl text-xs font-black ${item.rank <= 3 ? 'bg-gradient-to-br from-rose-100 to-red-100 text-rose-700 dark:from-rose-300/18 dark:to-red-300/12 dark:text-rose-100' : 'bg-secondary/70 text-primary'}`}>
                                {item.rank}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-foreground">{item.user_id}</p>
                              <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                                {profileCardLoadingId === item.user_id ? '전적 명함 불러오는 중' : `${item.wins}승 ${item.losses}패 ${item.draws}무 · 승률 ${decided > 0 ? `${winRate}%` : '-'}`}
                              </p>
                            </div>
                            <p className="text-left text-base font-black text-primary md:text-right">{item.rating.toLocaleString()}</p>
                            <p className="text-left text-xs font-black text-foreground md:text-right">{formatArenaTier(item.tier)}</p>
                            <p className="text-left text-xs font-black text-muted-foreground md:text-right">{item.wins + item.losses + item.draws}전</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                    <h3 className="text-base font-black text-foreground">상위권 포디움</h3>
                    <div className="mt-4 space-y-2">
                      {rankingTopThree.map((item) => (
                        <button
                          key={`podium-${item.rank}-${item.user_id}`}
                          type="button"
                          onClick={() => openArenaProfileCard(item.user_id)}
                          className="arena-status-row flex w-full items-center gap-3 rounded-3xl border border-border bg-card/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/30"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-100 via-pink-100 to-red-100 text-sm font-black text-rose-700 dark:from-rose-300/18 dark:via-pink-300/14 dark:to-red-300/12 dark:text-rose-100">
                            {item.rank}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-foreground">{item.user_id}</p>
                            <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{formatArenaTier(item.tier)} · {item.rating.toLocaleString()} MMR</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                    <h3 className="text-base font-black text-foreground">티어 분포</h3>
                    <div className="mt-4 space-y-3">
                      {rankingTierGroups.map((group) => (
                        <div key={group.tier}>
                          <div className="flex items-center justify-between text-[10px] font-black">
                            <span className="text-muted-foreground">{formatArenaTier(group.tier)}</span>
                            <span className="text-foreground">{group.count}명</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary/70">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary via-rose-300 to-red-300" style={{ width: `${Math.max(8, (group.count / Math.max(1, rankingItems.length)) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                    <h3 className="text-base font-black text-foreground">MMR 구간</h3>
                    <div className="mt-4 grid gap-2">
                      {rankingMmrBands.map((band) => (
                        <div key={band.id} className="arena-status-row flex items-center justify-between rounded-2xl border border-border bg-card/70 px-3 py-2">
                          <span className="text-xs font-black text-muted-foreground">{band.label}</span>
                          <span className="text-xs font-black text-foreground">{band.count}명</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
                    <h3 className="text-base font-black text-foreground">승률 상위</h3>
                    {rankingBestWinRate.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {rankingBestWinRate.map((item) => (
                          <button
                            key={`winrate-${item.rank}-${item.user_id}`}
                            type="button"
                            onClick={() => openArenaProfileCard(item.user_id)}
                            className="arena-status-row flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 px-3 py-2 text-left transition hover:border-primary/30"
                          >
                            <span className="min-w-0 truncate text-xs font-black text-foreground">{item.user_id}</span>
                            <span className="shrink-0 text-xs font-black text-primary">{item.winRate}%</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-2xl bg-secondary/52 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground">
                        최소 3전 이상 기록이 쌓이면 표시됩니다.
                      </p>
                    )}
                  </div>
                </aside>
              </section>

              {profileCardError ? (
                <p className="rounded-2xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 dark:bg-rose-300/10 dark:text-rose-100">
                  {profileCardError}
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : arenaSiteTab === 'style' ? (
        <section className="space-y-4">
          <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="flex items-center gap-2 text-lg font-black text-foreground">
                    <Store className="h-5 w-5 text-primary" />
                    아레나 스타일 상점
                  </h2>
                  {user ? (
                    <span className="cute-number-font inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">
                      <Coins className="h-3.5 w-3.5" />
                      {user.point.toLocaleString()} P
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">
                  포인트는 아레나 안에서 보이는 프레임, 이름 연출, 배틀 이모트에만 사용됩니다. 전투력, 매칭, MMR, 랭킹에는 연결되지 않습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setArenaHelpModal('style')}
                  className="cute-wiggle-hover inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-2.5 text-xs font-black text-primary"
                >
                  <HelpCircle className="h-4 w-4" />
                  스타일 도움말
                </button>
                <button
                  type="button"
                  onClick={() => loadMyArenaCosmetics(true)}
                  disabled={!user || arenaCosmeticsLoading}
                  className="cute-wiggle-hover inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${arenaCosmeticsLoading ? 'animate-spin' : ''}`} />
                  새로고침
                </button>
              </div>
            </div>

            {!user ? (
              <ArenaStateNotice title="로그인이 필요합니다" description="로그인하면 아레나 안에서 스타일 아이템을 구매하고 장착할 수 있습니다." />
            ) : arenaCosmeticsLoading && arenaShopItems.length === 0 ? (
              <ArenaListSkeleton rows={5} />
            ) : arenaCosmeticsError ? (
              <ArenaStateNotice
                variant="error"
                title="아레나 스타일 정보를 불러오지 못했습니다"
                description={arenaCosmeticsError}
                actionLabel="다시 확인"
                onAction={() => loadMyArenaCosmetics(true)}
                disabled={arenaCosmeticsLoading}
              />
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-card/60 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      ['all', '전체'],
                      ['border', '프로필 프레임'],
                      ['name_effect', '이름 연출'],
                      ['emote', '배틀 이모트']
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setArenaStyleFilter(id)}
                        className={`cute-wiggle-hover rounded-2xl px-3 py-2 text-[10px] font-black ${
                          arenaStyleFilter === id
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                    {filteredArenaShopItems.length.toLocaleString()}개
                  </span>
                </div>

                {filteredArenaShopItems.length === 0 ? (
                  <ArenaStateNotice
                    title="판매 중인 아레나 스타일 아이템이 없습니다"
                    description="새로운 스타일 아이템이 추가되면 이곳에서 확인할 수 있습니다."
                  />
                ) : (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredArenaShopItems.map((item) => (
                      <ArenaCosmeticCard
                        key={item.id}
                        item={item}
                        ownedCount={Number(arenaCosmeticOwned[item.id] || 0)}
                        purchaseCount={Number(arenaCosmeticPurchases[item.id] || 0)}
                        equipped={isArenaCosmeticEquipped(item)}
                        userPoint={user.point}
                        buying={arenaCosmeticBuyingId === item.id}
                        equipping={arenaCosmeticEquippingId === item.id}
                        onBuy={buyArenaCosmetic}
                        onEquip={(target) => equipArenaCosmetic(target)}
                        onUnequip={(target) => equipArenaCosmetic(target, null)}
                      />
                    ))}
                  </div>
                )}

                <div className="arena-emote-editor mt-6 rounded-[1.75rem] border border-rose-200/70 bg-gradient-to-br from-rose-50/72 via-white/72 to-pink-50/62 p-4 shadow-sm dark:border-rose-300/20 dark:from-rose-300/10 dark:via-white/5 dark:to-pink-300/10">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-black text-foreground">
                        <SmilePlus className="h-5 w-5 text-primary" />
                        파이 메뉴 편집
                      </h3>
                      <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">
                        상우하좌 방향에 장착할 배틀 이모트를 배치합니다.
                      </p>
                    </div>
                    <span className="rounded-full bg-white/72 px-3 py-1 text-[10px] font-black text-primary shadow-sm dark:bg-white/10">
                      {ownedArenaEmoteItems.length.toLocaleString()}개 보유
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
                    <div className="arena-emote-editor-wheel" aria-label="파이 메뉴 배치 미리보기">
                      {arenaEmoteSlots.map((slot) => {
                        const item = arenaCosmeticLoadout?.[slot.itemKey] as ArenaShopItem | null | undefined;
                        return (
                          <div key={slot.key} className={`arena-emote-editor-node is-${slot.direction}`}>
                            {item ? <ArenaEmoteBadge item={item} size="sm" /> : <span>{slot.label}</span>}
                          </div>
                        );
                      })}
                      <div className="arena-emote-editor-core">
                        <SmilePlus className="h-6 w-6" />
                      </div>
                    </div>
                    {ownedArenaEmoteItems.length === 0 ? (
                      <ArenaStateNotice
                        title="장착할 배틀 이모트가 없습니다"
                        description="구매한 배틀 이모트가 있으면 이곳에서 방향별 위치를 편집할 수 있습니다."
                      />
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {arenaEmoteSlots.map((slot) => {
                          const currentItemId = arenaCosmeticLoadout?.[slot.key] || '';
                          return (
                            <div key={slot.key} className="rounded-2xl border border-white/70 bg-white/72 p-3 shadow-sm dark:border-white/10 dark:bg-white/8">
                              <label className="text-[10px] font-black text-muted-foreground">{slot.label} 방향</label>
                              <select
                                value={currentItemId || ''}
                                onChange={(event) => setArenaEmoteSlot(slot.key, event.target.value ? Number(event.target.value) : null)}
                                disabled={arenaCosmeticEquippingId !== null}
                                className="mt-2 w-full rounded-2xl border border-border bg-card/80 px-3 py-2 text-xs font-bold text-foreground outline-none transition focus:border-primary disabled:opacity-50"
                              >
                                <option value="">비어 있음</option>
                                {ownedArenaEmoteItems.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </select>
                              <p className="mt-2 truncate text-[11px] font-black text-foreground">
                                {(arenaCosmeticLoadout?.[slot.itemKey] as ArenaShopItem | null | undefined)?.name || '비어 있음'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
            <ArenaStylePreview userName={user?.username || 'Arena'} loadout={arenaCosmeticLoadout} />

            <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-foreground">장착 상태</h2>
                  <p className="mt-1 text-[11px] font-bold text-muted-foreground">현재 아레나 화면에 적용될 스타일입니다.</p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">
                  {equippedArenaEmotes.length}/4 이모트
                </span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  ['프로필 프레임', arenaCosmeticLoadout?.border_item?.name || '기본 프레임'],
                  ['이름 연출', arenaCosmeticLoadout?.name_effect_item?.name || '기본 이름'],
                  ['배틀 이모트', equippedArenaEmotes.length > 0 ? `${equippedArenaEmotes.length}/4 장착` : '미장착']
                ].map(([label, value]) => (
                  <div key={label} className="arena-status-row rounded-2xl border border-border bg-card/70 px-3 py-2">
                    <span className="text-[10px] font-black text-muted-foreground">{label}</span>
                    <p className="mt-1 min-w-0 truncate text-xs font-black text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {arenaEmoteSlots.map((slot) => {
                  const item = arenaCosmeticLoadout?.[slot.itemKey] as ArenaShopItem | null | undefined;
                  return (
                    <div key={slot.key} className="rounded-2xl border border-border bg-card/70 p-2">
                      <div className="flex items-center gap-2">
                        {item ? <ArenaEmoteBadge item={item} size="sm" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-[10px] font-black text-muted-foreground">-</div>}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-black text-muted-foreground">{slot.label}</p>
                          <p className="truncate text-[11px] font-black text-foreground">{item?.name || '비어 있음'}</p>
                        </div>
                      </div>
                      {item ? (
                        <button
                          type="button"
                          onClick={() => equipArenaCosmetic(item, null)}
                          disabled={arenaCosmeticEquippingId === item.id}
                          className="mt-2 w-full rounded-xl bg-secondary/70 py-1.5 text-[10px] font-black text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          해제
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
      <section ref={previewSectionRef} className="space-y-4">
        <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-foreground">아레나 카드 풀</h2>
                {!hasArenaCards && !playCardPoolLoading ? (
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                    비어 있음
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {!hasArenaCards && !playCardPoolLoading
                  ? '아직 확인할 수 있는 아레나 카드가 없습니다.'
                : '소유 중인 아레나 카드 중 최대 12장을 무작위로 보여줍니다. 전체 목록과 덱 편집은 보관함과 덱 편집 영역에서 확인하세요.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setArenaHelpModal('play')}
                className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/8 px-3 py-2 text-xs font-black text-primary"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                플레이 도움말
              </button>
              <button
                type="button"
                onClick={loadArenaPreview}
                className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-xs font-black text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                새로고침
              </button>
            </div>
          </div>

          {playCardPoolLoading ? (
            <ArenaCardSkeletonGrid />
          ) : playCardPoolError ? (
            <ArenaStateNotice
              variant="error"
              title="카드 풀을 불러오지 못했습니다"
              description={playCardPoolError}
              actionLabel="다시 불러오기"
              onAction={reloadPlayCardPool}
              disabled={playCardPoolLoading}
            />
          ) : displayedCards.length === 0 ? (
            <ArenaStateNotice
              title="아직 보여줄 카드가 없습니다"
              description="아레나 카드가 등록되면 클래스, 스탯, 스킬을 이곳에서 확인할 수 있습니다."
              actionLabel="다시 불러오기"
              onAction={reloadPlayCardPool}
              disabled={playCardPoolLoading}
            />
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {displayedCards.map((card) => (
                <ArenaCompactCardPreview key={card.card_id} card={card} />
              ))}
            </div>
          )}
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(18rem,0.55fr)_minmax(0,1.45fr)]">
          <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-base font-black text-foreground">시즌 상태</h2>
            </div>
            <div className="mt-4 space-y-3">
              <div className="arena-metric-tile rounded-3xl bg-secondary/60 p-4">
                <p className="text-[10px] font-black text-muted-foreground">현재 시즌</p>
                <p className="mt-1 text-lg font-black text-foreground">{season?.name || '프리시즌'}</p>
              </div>
              {statusItems.map(([label, enabled]) => (
                <div key={String(label)} className="arena-status-row flex items-center justify-between rounded-2xl border border-border bg-card/70 px-3 py-2">
                  <span className="text-xs font-black text-muted-foreground">{label}</span>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-black ${enabled ? 'text-rose-600 dark:text-rose-200' : 'text-muted-foreground'}`}>
                    {enabled ? <span className="arena-live-dot h-1.5 w-1.5 rounded-full bg-rose-400" /> : null}
                    {enabled ? '활성' : '준비 중'}
                  </span>
                </div>
              ))}
              {battlefieldRules.length > 0 ? (
                <div className="rounded-3xl border border-rose-200/70 bg-rose-50/70 p-3 dark:border-rose-300/20 dark:bg-rose-300/10">
                  <div className="flex items-center gap-1.5">
                    <MapIcon className="h-3.5 w-3.5 text-rose-700 dark:text-rose-100" />
                    <p className="text-[10px] font-black text-rose-700 dark:text-rose-100">자동 전장 규칙</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {battlefieldRules.slice(0, 4).map((rule) => (
                      <span key={rule.id} className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-black text-muted-foreground dark:bg-white/10">
                        {rule.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-black text-foreground">내 아레나</h2>
              <button
                type="button"
                onClick={() => setArenaHelpModal('play')}
                className="rounded-2xl border border-border bg-secondary/60 px-3 py-2 text-[10px] font-black text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground"
              >
                아레나 도움말
              </button>
            </div>
            {user ? (
              <div className="mt-4 space-y-3">
                <div className="arena-status-row rounded-3xl border border-border bg-card/70 p-4">
                  <p className="text-[10px] font-black text-muted-foreground">스트리머 카드 사용 상태</p>
                  {myCardLoading ? (
                    <p className="mt-2 text-sm font-black text-foreground">확인 중...</p>
                  ) : myStreamerCard ? (
                    <>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-black text-foreground">{myStreamerCard.card?.name || myStreamerCard.channel_id}</p>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${myStreamerCard.is_enabled ? 'bg-rose-100 text-rose-700 dark:bg-rose-300/15 dark:text-rose-100' : 'bg-red-100 text-red-700 dark:bg-red-300/15 dark:text-red-100'}`}>
                          {myStreamerCard.is_enabled ? '사용 중' : '비활성화됨'}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                        비활성화하면 신규 매치, 봇 덱, 추천 덱에서 제외됩니다. 재활성화는 다음 카드 풀 갱신부터 반영됩니다.
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleMyArenaCard(!myStreamerCard.is_enabled)}
                        disabled={myCardActionLoading}
                        className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-black ${myStreamerCard.is_enabled ? 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100' : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'} disabled:opacity-60`}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        {myCardActionLoading ? '처리 중...' : myStreamerCard.is_enabled ? '아레나 사용 비활성화' : '아레나 사용 재활성화'}
                      </button>
                      {streamerConfigOptions ? (
                        <div className="mt-4 space-y-3 rounded-3xl border border-primary/15 bg-primary/5 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-black text-primary">카드 콘셉트 설정</p>
                              <p className="mt-1 text-[11px] font-bold leading-relaxed text-muted-foreground">
                                총 스탯 예산 {streamerConfigOptions.balance_policy.fixed_stat_budget} 안에서 역할과 성향만 고릅니다.
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                              {myStreamerCard.config_status === 'configured' ? '직접 설정' : '자동 템플릿'}
                            </span>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="min-w-0 text-[10px] font-black text-muted-foreground">
                              클래스
                              <select
                                value={streamerSelectedClassId}
                                onChange={(event) => {
                                  const nextClassId = event.target.value;
                                  const nextSkills = pickDefaultSkillIds(streamerConfigOptions.skills_by_class?.[nextClassId] || []);
                                  updateMyStreamerCardDraft({ class_id: nextClassId, skill_ids: nextSkills });
                                }}
                                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary"
                              >
                                {streamerConfigOptions.classes.map((arenaClass) => (
                                  <option key={arenaClass.id} value={arenaClass.id}>{arenaClass.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="min-w-0 text-[10px] font-black text-muted-foreground">
                              대표 스탯
                              <select
                                value={myStreamerCardDraft.stat_focus || 'hp'}
                                onChange={(event) => updateMyStreamerCardDraft({ stat_focus: event.target.value as keyof ArenaCard['stats'] })}
                                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary"
                              >
                                {streamerConfigOptions.stat_focuses.map((focus) => (
                                  <option key={focus.id} value={focus.id}>{focus.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="min-w-0 text-[10px] font-black text-muted-foreground">
                              전술 성향
                              <select
                                value={myStreamerCardDraft.combat_style || 'balanced'}
                                onChange={(event) => updateMyStreamerCardDraft({ combat_style: event.target.value })}
                                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary"
                              >
                                {streamerConfigOptions.combat_styles.map((style) => (
                                  <option key={style.id} value={style.id}>{style.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[10px] font-black text-muted-foreground">스킬 슬롯</p>
                              <p className="text-[10px] font-bold text-muted-foreground">액티브, 패시브, 궁극기를 각각 1개씩 사용합니다.</p>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              {streamerSkillSlots.map((slot) => {
                                const selectedSkill = slot.options.find((skill) => skill.id === slot.selectedId) || slot.options[0];
                                return (
                                  <label key={slot.type} className="arena-tactic-card rounded-2xl border border-transparent bg-card/80 px-3 py-2 text-left text-muted-foreground">
                                    <span className="block text-[10px] font-black text-primary">{slot.label}</span>
                                    <select
                                      value={selectedSkill?.id || ''}
                                      onChange={(event) => updateMyStreamerSkillSlot(slot.type, event.target.value)}
                                      className="mt-1 w-full rounded-2xl border border-border bg-background px-2.5 py-2 text-xs font-black text-foreground outline-none focus:border-primary"
                                    >
                                      {slot.options.map((skill) => (
                                        <option key={skill.id} value={skill.id}>{skill.name}</option>
                                      ))}
                                    </select>
                                    {selectedSkill ? (
                                      <ArenaSkillTooltip skill={selectedSkill}>
                                        <span className="mt-1.5 block line-clamp-2 cursor-help text-[10px] font-bold opacity-80">{selectedSkill.description}</span>
                                      </ArenaSkillTooltip>
                                    ) : (
                                      <span className="mt-1.5 block text-[10px] font-bold opacity-80">사용 가능한 스킬이 없습니다.</span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] font-black text-muted-foreground">태그 {streamerSelectedTagIds.length}/{streamerConfigOptions.limits.tag_ids}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {streamerConfigOptions.tag_options.map((tag) => {
                                const selected = streamerSelectedTagIds.includes(tag);
                                return <ArenaTagBadge key={tag} tag={tag} selected={selected} asButton onClick={() => toggleMyStreamerTag(tag)} />;
                              })}
                            </div>
                          </div>

                          <label className="block text-[10px] font-black text-muted-foreground">
                            카드 소개 문구
                            <textarea
                              value={myStreamerCardDraft.flavor_text || ''}
                              onChange={(event) => updateMyStreamerCardDraft({ flavor_text: event.target.value.slice(0, streamerConfigOptions.limits.flavor_text_length) })}
                              maxLength={streamerConfigOptions.limits.flavor_text_length}
                              rows={2}
                              className="mt-1 w-full resize-none rounded-2xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground outline-none focus:border-primary"
                              placeholder="카드의 콘셉트를 짧게 적어주세요."
                            />
                          </label>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() => saveMyStreamerCardConfig(false)}
                              disabled={myCardConfigSaving}
                              className="arena-primary-cta inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
                            >
                              <Sparkles className="h-4 w-4" />
                              {myCardConfigSaving ? '저장 중...' : '콘셉트 저장'}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveMyStreamerCardConfig(true)}
                              disabled={myCardConfigSaving}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-xs font-black text-muted-foreground disabled:opacity-60"
                            >
                              자동 템플릿으로 되돌리기
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                      본인 채널의 스트리머 카드가 등록되면 이곳에서 아레나 사용 여부를 관리할 수 있습니다.
                    </p>
                  )}
                </div>
                <div className="arena-status-row rounded-3xl border border-border bg-card/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground">저장 덱</p>
                      <p className="mt-1 text-sm font-black text-foreground">{deckLoading ? '불러오는 중...' : `${decks.length}개`}</p>
                    </div>
                    <button
                      type="button"
                      onClick={startNewDeckEditor}
                      disabled={deckActionLoading || ownedCards.length < 6}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm disabled:opacity-50"
                      aria-label="새 덱 편집"
                    >
                      <PlusCircle className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {deckLoading && decks.length === 0 ? (
                      <ArenaListSkeleton rows={3} />
                    ) : deckError ? (
                      <ArenaStateNotice
                        variant="error"
                        title="덱을 불러오지 못했습니다"
                        description={deckError}
                        actionLabel="다시 확인"
                        onAction={loadMyArenaDecks}
                        disabled={deckLoading}
                      />
                    ) : decks.length === 0 ? (
                      <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
                        보유 카드에서 6~10장을 골라 첫 덱을 만들 수 있습니다.
                      </p>
                    ) : decks.map((deck) => (
                      <div key={deck.id} className="arena-deck-row flex items-center justify-between gap-2 rounded-2xl bg-secondary/52 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-foreground">{deck.name}</p>
                          <p className="text-[10px] font-bold text-muted-foreground">
                            {deck.cards.length}장 · {deck.validation_status === 'VALID' ? '검증 완료' : '수정 필요'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDeckEditor(deck)}
                            disabled={deckActionLoading}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card text-foreground disabled:opacity-50"
                            aria-label="덱 수정"
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startQuickMatch(deck.id)}
                            disabled={!season?.quick_match_enabled || Boolean(quickMatchLoadingDeckId) || deck.validation_status !== 'VALID'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-50 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100"
                            aria-label="빠른대전"
                          >
                            <Swords className={`h-3.5 w-3.5 ${quickMatchLoadingDeckId === deck.id ? 'animate-pulse' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => startCup(deck.id)}
                            disabled={!season?.cup_enabled || Boolean(cupLoadingDeckId) || deck.validation_status !== 'VALID'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 disabled:opacity-50 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100"
                            aria-label="8인 컵"
                          >
                            <Trophy className={`h-3.5 w-3.5 ${cupLoadingDeckId === deck.id ? 'animate-pulse' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => startBotPractice(deck.id)}
                            disabled={Boolean(botMatchLoadingDeckId) || deck.validation_status !== 'VALID'}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                            aria-label="봇 연습전"
                          >
                            <Bot className={`h-3.5 w-3.5 ${botMatchLoadingDeckId === deck.id ? 'animate-pulse' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteDeck(deck.id)}
                            disabled={deckActionLoading}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 disabled:opacity-50 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100"
                            aria-label="덱 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {cupStatus && cupStatus.status !== 'none' ? (
                  <div className="rounded-3xl border border-red-200 bg-red-50/80 p-4 dark:border-red-300/20 dark:bg-red-300/10">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-red-700 dark:text-red-100">8인 컵 상태</p>
                        <p className="mt-1 truncate text-sm font-black text-foreground">
                          {cupStatus.status === 'queued' ? '컵 참가 대기 중' : cupStatus.status === 'matched' ? '컵 완료' : cupStatus.status === 'cancelled' ? '대기 취소됨' : '대기 만료됨'}
                        </p>
                      </div>
                      {cupStatus.status === 'queued' ? (
                        <button
                          type="button"
                          onClick={cancelCup}
                          className="inline-flex items-center gap-1.5 rounded-2xl border border-red-200 bg-white/80 px-3 py-2 text-[11px] font-black text-red-700 dark:border-red-300/20 dark:bg-white/10 dark:text-red-100"
                        >
                          취소
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                      {cupStatus.status === 'queued'
                        ? `${cupStatus.queued_count || 1}/${cupStatus.required_count || 8}명 대기 중 · 연결 중에는 결과가 즉시 도착합니다.`
                        : cupStatus.cup_id
                          ? `컵 ID ${cupStatus.cup_id} · 모든 경기는 완료 리플레이로만 저장됩니다.`
                          : '상대에게 영향 없이 내 컵 대기만 정리되었습니다.'}
                    </p>
                    {lastCup?.cup ? (
                      <div className="mt-3 rounded-2xl bg-white/70 px-3 py-2 dark:bg-white/10">
                        <p className="text-[10px] font-black text-muted-foreground">최근 컵 결과</p>
                        <p className="mt-1 text-xs font-black text-foreground">
                          우승 {lastCup.cup.champion_user_id || '-'} · {lastCup.cup.bracket?.matches?.length || 0}경기
                        </p>
                        {(lastCup.cup.bracket?.matches || []).length > 0 ? (
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                            {(lastCup.cup.bracket?.matches || []).map((match) => {
                              const playerA = match.player_a?.deck_name || match.player_a?.user_id || 'A';
                              const playerB = match.player_b?.deck_name || match.player_b?.user_id || 'B';
                              return (
                                <div key={`${match.stage}-${match.index}`} className="rounded-xl bg-red-100/70 px-2.5 py-2 text-[10px] font-bold text-red-900 dark:bg-red-100/10 dark:text-red-50">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-black">{cupStageLabels[match.stage] || match.stage} {match.index}</span>
                                    <span>{match.player_a_round_wins}:{match.player_b_round_wins}</span>
                                  </div>
                                  <p className="mt-1 truncate text-red-800/80 dark:text-red-100/80">{playerA} vs {playerB}</p>
                                  <p className="mt-0.5 truncate">승자 {match.winner_user_id}</p>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {quickMatch && quickMatch.status !== 'none' ? (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50/80 p-4 dark:border-rose-300/20 dark:bg-rose-300/10">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-rose-700 dark:text-rose-100">빠른대전 상태</p>
                        <p className="mt-1 truncate text-sm font-black text-foreground">
                          {quickMatch.status === 'queued' ? '빠른대전 매칭 중' : quickMatch.status === 'matched' ? '매칭 완료' : quickMatch.status === 'cancelled' ? '대기 취소됨' : '대기 만료됨'}
                        </p>
                      </div>
                      {quickMatch.status === 'queued' ? (
                        <button
                          type="button"
                          onClick={cancelQuickMatch}
                          className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-white/80 px-3 py-2 text-[11px] font-black text-rose-700 dark:border-rose-300/20 dark:bg-white/10 dark:text-rose-100"
                        >
                          취소
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                      {quickMatch.status === 'queued'
                        ? `${quickMatch.elapsed_sec || 0}초 대기 중 · 연결 중에는 매칭 결과가 즉시 도착합니다.`
                        : quickMatch.match_id
                          ? `매치 ID ${quickMatch.match_id} · 라운드 선택 화면에서 전술을 조정하며 진행합니다.`
                          : '상대에게 영향 없이 내 큐만 정리되었습니다.'}
                    </p>
                  </div>
                ) : null}

                {user ? (
                  <div className="arena-planner-card rounded-3xl border border-border bg-card/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-muted-foreground">덱 편집</p>
                        <p className="mt-1 text-sm font-black text-foreground">보유 카드에서 6~10장을 선택하세요</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${deckEditorMissingCount > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-300/10 dark:text-amber-100' : 'bg-primary/10 text-primary'}`}>
                        {deckEditorCardIds.length}/{ARENA_DECK_CARD_LIMIT}장
                      </span>
                    </div>
                    <label className="mt-3 block text-[10px] font-black text-muted-foreground">
                      덱 이름
                      <input
                        value={deckEditorName}
                        onChange={(event) => setDeckEditorName(event.target.value.slice(0, 80))}
                        className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary"
                        placeholder="아레나 덱"
                      />
                    </label>
                    <div className="mt-3 rounded-3xl border border-border bg-secondary/28 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-black text-muted-foreground">선택한 카드</p>
                        {deckEditorMissingCount > 0 ? (
                          <span className="text-[10px] font-black text-amber-700 dark:text-amber-100">{deckEditorMissingCount}장 더 필요</span>
                        ) : (
                          <span className="text-[10px] font-black text-primary">저장 가능</span>
                        )}
                      </div>
                      {deckEditorCardIds.length === 0 ? (
                        <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">아래 보유 카드 목록에서 덱에 넣을 카드를 선택하세요.</p>
                      ) : (
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {deckEditorCardIds.map((cardId, index) => {
                            const card = deckEditorCardById.get(cardId);
                            return (
                              <button
                                key={cardId}
                                type="button"
                                onClick={() => toggleDeckEditorCard(cardId)}
                                className="arena-card-token min-w-0 rounded-2xl border border-primary/20 bg-primary/10 px-2.5 py-2 text-left text-foreground"
                                aria-label="덱에서 제거"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/80 text-[10px] font-black text-primary dark:bg-white/10">
                                    {card?.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : index + 1}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-[10px] font-black">{card?.name || cardId.replace('arena_streamer_', '')}</span>
                                    <span className="block truncate text-[9px] font-bold text-muted-foreground">클릭하면 제거</span>
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <label className="mt-3 block">
                      <span className="text-[10px] font-black text-muted-foreground">카드 검색</span>
                      <span className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 focus-within:border-primary">
                        <Search className="h-4 w-4 shrink-0 text-primary" />
                        <input
                          value={deckEditorSearch}
                          onChange={(event) => setDeckEditorSearch(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-xs font-black text-foreground outline-none placeholder:text-muted-foreground"
                          placeholder="이름, 클래스, 역할, 스킬, 태그 검색"
                        />
                      </span>
                    </label>
                    <div className="mt-3 grid max-h-[22rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {ownedCards.length === 0 ? (
                        <ArenaStateNotice title="덱에 넣을 보유 카드가 없습니다" description="아레나에 사용할 수 있는 보유 카드가 생기면 이곳에서 덱을 구성할 수 있습니다." />
                      ) : filteredDeckEditorCards.length === 0 ? (
                        <ArenaStateNotice title="검색 결과가 없습니다" description="다른 이름, 클래스, 역할, 스킬명으로 다시 찾아보세요." />
                      ) : filteredDeckEditorCards.map((card) => {
                        const selected = deckEditorCardIds.includes(card.card_id);
                        return (
                          <button
                            key={card.card_id}
                            type="button"
                            onClick={() => toggleDeckEditorCard(card.card_id)}
                            className={`arena-tactic-card min-w-0 rounded-2xl border px-3 py-2 text-left ${selected ? 'is-selected border-primary/35 bg-primary text-primary-foreground shadow-sm' : 'border-transparent bg-secondary/52 text-muted-foreground'}`}
                            aria-pressed={selected}
                            aria-label={`${selected ? '덱에서 제거' : '덱에 추가'}: ${card.name}`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="h-9 w-9 shrink-0 overflow-hidden rounded-2xl bg-white/80 dark:bg-white/10">
                                {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-black">{card.name}</span>
                                <span className="mt-0.5 block truncate text-[10px] font-bold opacity-80">
                                  <ArenaClassTooltip cardClass={card.class}>
                                    <span>{card.class.name}</span>
                                  </ArenaClassTooltip>
                                  {card.skills.slice(0, 3).map((skill) => (
                                    <React.Fragment key={skill.id}>
                                      <span> · </span>
                                      <ArenaSkillTooltip skill={skill}>
                                        <span>{skill.name}</span>
                                      </ArenaSkillTooltip>
                                    </React.Fragment>
                                  ))}
                                </span>
                              </span>
                              <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-white/10 dark:text-primary-foreground">
                                {selected ? '선택' : '+'}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={saveDeckEditor}
                        disabled={deckEditorSaving || deckEditorCardIds.length < 6 || deckEditorCardIds.length > ARENA_DECK_CARD_LIMIT}
                        className="arena-primary-cta inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {deckEditorSaving ? '저장 중...' : deckEditorId ? '덱 수정 저장' : '새 덱 저장'}
                      </button>
                      <button
                        type="button"
                        onClick={resetDeckEditor}
                        disabled={deckEditorSaving}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-xs font-black text-muted-foreground disabled:opacity-50"
                      >
                        선택 비우기
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
                      라운드별 전술과 출전 배치는 게임이 잡힌 뒤 각 라운드마다 직접 선택합니다.
                    </p>
                  </div>
                ) : null}

                {selectedReplayMatch ? (
                  <div className="arena-status-row rounded-3xl border border-border bg-card/70 p-4">
                    <p className="text-[10px] font-black text-muted-foreground">선택한 최근 경기</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-foreground">
                        {isRoundBattleRevealing ? `${roundReveal?.roundNo || selectedReplayMatch.round_count}라운드 전투 중` : selectedMatchResultLabel}
                      </p>
                      <span className="rounded-full bg-secondary/70 px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                        {isRoundBattleRevealing ? '결과 집계 중' : `${selectedReplayMatch.player_a_round_wins}:${selectedReplayMatch.player_b_round_wins} · ${selectedReplayMatch.round_count}R`}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-muted-foreground">
                      매치 ID {selectedReplayMatch.id} · 라운드가 끝날 때마다 다음 선택으로 전투 흐름을 바꿉니다.
                    </p>
                    {isArenaMatchCompleted(selectedReplayMatch) ? (
                      <button
                        type="button"
                        onClick={() => createArenaShareLink(selectedReplayMatch.id)}
                        disabled={shareLoadingMatchId === selectedReplayMatch.id}
                        className="cute-wiggle-hover mt-3 inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground disabled:opacity-50"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        {shareLoadingMatchId === selectedReplayMatch.id ? '생성 중' : '관전 링크 복사'}
                      </button>
                    ) : null}
                    {roundWait ? (
                      <div className="mt-3 rounded-3xl border border-red-200 bg-red-50/80 p-4 dark:border-red-300/20 dark:bg-red-300/10">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black text-red-700 dark:text-red-100">상대 선택 대기</p>
                            <p className="mt-1 text-sm font-black text-foreground">
                              {canForceRoundAfterWait ? '선택 시간이 끝났습니다' : `${roundWaitRemainingSec}초 남음`}
                            </p>
                          </div>
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-red-700 shadow-sm dark:bg-white/10 dark:text-red-100">
                            <Clock3 className="h-5 w-5" />
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-red-400 transition-all duration-500"
                            style={{ width: `${canForceRoundAfterWait ? 100 : Math.max(8, Math.min(100, 100 - (roundWaitRemainingMs / ARENA_ROUND_SELECTION_TIMEOUT_MS) * 100))}%` }}
                          />
                        </div>
                        <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                          {canForceRoundAfterWait
                            ? '지금 시작하면 상대는 저장된 기본 라운드 플랜으로 움직입니다.'
                            : '상대가 선택을 마치면 바로 전투가 시작됩니다. 시간이 끝나면 기본 플랜으로 진행할 수 있습니다.'}
                        </p>
                      </div>
                    ) : null}
                    {roundReveal ? (
                      <div className={`arena-round-reveal mt-3 rounded-3xl border p-4 ${roundReveal.stage === 'battle' ? 'is-battle border-rose-200 bg-rose-50/80 dark:border-rose-300/20 dark:bg-rose-300/10' : 'is-result border-primary/20 bg-primary/10'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black text-muted-foreground">R{roundReveal.roundNo}</p>
                            <p className="mt-1 truncate text-base font-black text-foreground">
                              {roundReveal.stage === 'battle' ? '전투가 펼쳐지는 중' : roundRevealResultLabel}
                            </p>
                          </div>
                          <div className="arena-round-orb flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-primary shadow-sm dark:bg-white/10">
                            <Swords className="h-5 w-5" />
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                          <div className={`h-full rounded-full ${roundReveal.stage === 'battle' ? 'arena-battle-progress bg-rose-500' : 'bg-primary'}`} />
                        </div>
                        <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                          {roundReveal.stage === 'battle'
                            ? '공격 순서와 스킬 교환을 재생한 뒤 라운드 결과가 공개됩니다.'
                            : roundReveal.completed
                              ? '세트가 종료되었습니다. 전체 리플레이에서 라운드별 흐름을 확인할 수 있습니다.'
                              : '다음 라운드 전술을 다시 고르면 새로운 라운드가 계산됩니다.'}
                        </p>
                      </div>
                    ) : null}
                    {isArenaMatchInProgress(selectedReplayMatch) ? (
                      <div className="mt-3 rounded-3xl border border-primary/20 bg-primary/8 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-black text-primary">다음 라운드 전술</p>
                            <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                              선택 후 서버가 이 라운드만 새로 계산합니다.
                            </p>
                          </div>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-white/10">
                            R{selectedReplayMatch.summary?.current_round_no || selectedReplayMatch.round_count + 1}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2">
                          <div className="grid grid-cols-3 gap-1.5">
                            {tacticOptions.map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setRoundCommitTactic(id)}
                                className={`rounded-2xl px-2 py-2 text-[10px] font-black transition ${roundCommitTactic === id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-primary/10 hover:text-primary dark:bg-white/10'}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {focusOptions.map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setRoundCommitFocus(id)}
                                className={`rounded-2xl px-2 py-2 text-[10px] font-black transition ${roundCommitFocus === id ? 'bg-rose-500 text-white shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-rose-100 hover:text-rose-700 dark:bg-white/10 dark:hover:bg-rose-300/15 dark:hover:text-rose-100'}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          {tacticChipOptions.length > 0 ? (
                            <select
                              value={roundCommitChipId}
                              onChange={(event) => setRoundCommitChipId(event.target.value)}
                              className="h-10 rounded-2xl border border-border bg-white/80 px-3 text-[11px] font-black text-foreground outline-none focus:border-primary dark:bg-card/80"
                            >
                              {tacticChipOptions.map((chip) => (
                                <option key={chip.id} value={chip.id}>{chip.name}</option>
                              ))}
                            </select>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => commitSelectedArenaRound()}
                            disabled={roundCommitLoading || isRoundBattleRevealing || Boolean(roundWait && !canForceRoundAfterWait)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 py-2.5 text-[11px] font-black text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
                          >
                            <Swords className="h-3.5 w-3.5" />
                            {roundCommitLoading || isRoundBattleRevealing
                              ? '전투 중'
                              : roundWait
                                ? canForceRoundAfterWait ? '자동 진행' : '상대 선택 대기'
                                : '라운드 시작'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {selectedReplay ? (
                      <div className="mt-3 rounded-2xl bg-secondary/52 px-3 py-2">
                        <p className="text-[10px] font-black text-muted-foreground">리플레이 요약</p>
                        <p className="mt-1 text-xs font-black text-foreground">
                          {selectedReplay.rounds.length}라운드 · 주요 장면 {selectedReplay.rounds.reduce((total, round) => total + round.events.length, 0)}개
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <StatBar label="덱 준비도" value={decks.length > 0 ? 70 : 22} />
                <StatBar label="리플레이 확인" value={selectedReplayMatch ? 35 : 0} />
              </div>
            ) : (
              <p className="mt-4 text-xs font-bold leading-relaxed text-muted-foreground">
                로그인하면 덱 편성, 봇 연습, 랭크 정보, 스트리머 카드 사용 설정이 이 영역에 표시됩니다.
              </p>
            )}
          </div>
        </div>
      </section>

      {user ? (
        <section>
          <div className="arena-panel-soft cute-surface rounded-[2rem] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileClock className="h-5 w-5 text-primary" />
                <h2 className="text-base font-black text-foreground">최근 경기</h2>
              </div>
              <button type="button" onClick={loadMyRecentArenaMatches} className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground">
                <RefreshCw className={`h-3.5 w-3.5 ${recentMatchesLoading ? 'animate-spin' : ''}`} />
                갱신
              </button>
            </div>
            {recentMatchesLoading && recentMatches.length === 0 ? (
              <ArenaListSkeleton rows={4} />
            ) : recentMatchesError ? (
              <ArenaStateNotice
                variant="error"
                title="최근 경기를 불러오지 못했습니다"
                description={recentMatchesError}
                actionLabel="다시 확인"
                onAction={loadMyRecentArenaMatches}
                disabled={recentMatchesLoading}
              />
            ) : recentMatches.length === 0 ? (
              <ArenaStateNotice
                title="아직 아레나 경기 기록이 없습니다"
                description="경기를 시작하면 진행 중인 매치와 완료 기록이 이곳에 표시됩니다."
              />
            ) : (
              <div className="mt-4 space-y-2">
                {recentMatches.map((match) => {
                  const inProgress = isArenaMatchInProgress(match);
                  const resultLabel = inProgress ? '진행 중' : getArenaMatchResultLabel(match);
                  return (
                    <div key={match.id} className="arena-status-row flex items-center justify-between gap-3 rounded-3xl border border-border bg-card/70 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-foreground">{match.match_type === 'RANKED' ? '빠른대전' : 'AI 연습'} · {resultLabel}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{formatDateTime(match.created_at)} · {match.player_a_round_wins}:{match.player_b_round_wins} · {match.summary?.battlefield_rule?.name || '기본 전장'}</p>
                      </div>
                      <button type="button" onClick={() => loadRecentMatchReplay(match)} className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-primary px-3 py-2 text-[10px] font-black text-primary-foreground">
                        <Eye className="h-3.5 w-3.5" />
                        {inProgress ? '계속' : '보기'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="arena-panel-soft cute-surface rounded-[2rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-base font-black text-foreground">관전 리플레이</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              공유받은 관전 링크나 토큰으로 완료 리플레이를 조회합니다.
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <input
              value={spectatorShareToken}
              onChange={(event) => {
                setSpectatorShareToken(event.target.value);
                if (spectatorError) setSpectatorError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') loadSpectatorReplay();
              }}
              className="min-w-0 flex-1 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/30 sm:w-56"
              placeholder="공유 링크 또는 토큰"
            />
            <button
              type="button"
              onClick={loadSpectatorReplay}
              disabled={spectatorLoading || !spectatorShareToken.trim()}
              className="cute-wiggle-hover inline-flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${spectatorLoading ? 'animate-spin' : ''}`} />
              조회
            </button>
          </div>
        </div>
        {spectatorLoading && !spectatorReplay ? (
          <ArenaListSkeleton rows={2} />
        ) : spectatorReplay ? (
          <div className="arena-status-row mt-4 rounded-3xl border border-border bg-card/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-muted-foreground">매치 ID</p>
                <p className="mt-1 text-sm font-black text-foreground">{spectatorReplay.match.match_id}</p>
              </div>
              <span className="rounded-full bg-secondary/70 px-3 py-1 text-[10px] font-black text-muted-foreground">
                {spectatorReplay.match.player_a_round_wins}:{spectatorReplay.match.player_b_round_wins} · {spectatorReplay.match.round_count}R
              </span>
            </div>
            <p className="mt-3 text-xs font-bold text-muted-foreground">
              {spectatorReplay.replay.rounds.length}라운드 · {spectatorReplay.replay.rounds.reduce((total, round) => total + round.events.length, 0)} 이벤트 · 완료 리플레이
            </p>
          </div>
        ) : spectatorError ? (
          <ArenaStateNotice
            variant="error"
            title="관전 리플레이를 찾지 못했습니다"
            description={spectatorError}
            actionLabel="다시 조회"
            onAction={loadSpectatorReplay}
            disabled={spectatorLoading || !spectatorShareToken.trim()}
          />
        ) : (
          <ArenaStateNotice
            title="조회된 관전 리플레이가 없습니다"
            description="공유 링크 또는 토큰을 입력하면 이곳에 요약이 표시됩니다."
          />
        )}
      </section>

      {selectedReplayMatch && selectedReplay && selectedReplay.rounds.length > 0 && !isRoundBattleRevealing ? (
        <ArenaReplayPanel match={selectedReplayMatch} replay={selectedReplay} currentUserId={user?.id} emoteLoadout={arenaCosmeticLoadout} />
      ) : null}
      {spectatorReplay ? (
        <ArenaReplayPanel
          match={{
            id: spectatorReplay.match.match_id,
            result: spectatorReplay.match.player_a_round_wins > spectatorReplay.match.player_b_round_wins ? 'win' : spectatorReplay.match.player_a_round_wins < spectatorReplay.match.player_b_round_wins ? 'loss' : 'draw',
            round_count: spectatorReplay.match.round_count,
            player_a_round_wins: spectatorReplay.match.player_a_round_wins,
            player_b_round_wins: spectatorReplay.match.player_b_round_wins,
            difficulty: 'spectator',
            created_at: spectatorReplay.match.created_at,
            summary: {
              player_deck: spectatorReplay.match.player_deck,
              bot_deck: spectatorReplay.match.opponent_deck
            }
          }}
          replay={spectatorReplay.replay}
          currentUserId={user?.id}
          emoteLoadout={arenaCosmeticLoadout}
        />
      ) : null}
      {profileCardUser ? (
        <ArenaProfileCardModal profile={profileCardUser} onClose={() => setProfileCardUser(null)} />
      ) : null}
        </>
      )}
      {showQueueModal && activeQueueModal ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-rose-950/22 px-3 py-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={activeQueueModal.label}>
          <div className={`relative w-full max-w-md overflow-hidden rounded-[2rem] border bg-gradient-to-br p-5 shadow-[0_24px_80px_rgba(88,17,35,0.24)] ${activeQueueModal.toneClass}`}>
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-white/80" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/84 shadow-sm dark:bg-white/10">
                  <ActiveQueueIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black opacity-80">{activeQueueModal.label}</p>
                  <h2 className="mt-1 text-lg font-black text-foreground">{activeQueueModal.title}</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQueueModalDismissedFor(activeQueueModal.key)}
                className="shrink-0 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[10px] font-black text-muted-foreground shadow-sm hover:text-foreground dark:border-white/10 dark:bg-white/10"
              >
                작게 보기
              </button>
            </div>
            <p className="mt-4 text-xs font-bold leading-relaxed text-muted-foreground">{activeQueueModal.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/72 px-3 py-3 dark:bg-white/10">
                <p className="text-[10px] font-black text-muted-foreground">대기 시간</p>
                <p className="mt-1 text-xl font-black text-foreground">{activeQueueModal.elapsedLabel}</p>
              </div>
              <div className="rounded-2xl bg-white/72 px-3 py-3 dark:bg-white/10">
                <p className="text-[10px] font-black text-muted-foreground">진행 상태</p>
                <p className="mt-1 text-xl font-black text-foreground">{activeQueueModal.progressLabel}</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/72 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-current transition-all duration-500"
                style={{ width: cupQueueActive ? `${Math.max(8, Math.min(100, (Number(cupStatus?.queued_count || 1) / Math.max(1, Number(cupStatus?.required_count || 8))) * 100))}%` : '66%' }}
              />
            </div>
            <p className="mt-3 rounded-2xl bg-white/68 px-3 py-2 text-[11px] font-black leading-relaxed text-foreground/80 dark:bg-white/10">
              {activeQueueModal.estimateLabel}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={activeQueueModal.onCancel}
                className="cute-wiggle-hover inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/82 px-4 py-2.5 text-xs font-black text-foreground shadow-sm dark:border-white/10 dark:bg-white/10"
              >
                대기 취소
              </button>
              <button
                type="button"
                onClick={() => setQueueModalDismissedFor(activeQueueModal.key)}
                className="arena-primary-cta cute-wiggle-hover inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground"
              >
                계속 기다리기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {arenaHelpModal ? (
        <ArenaHelpModal mode={arenaHelpModal} onClose={() => setArenaHelpModal(null)} />
      ) : null}
    </div>
  );
};

const ArenaEmptyShowcase: React.FC = () => (
  <div className="arena-empty-state rounded-[1.75rem] border border-dashed border-rose-200 bg-white/68 p-5 shadow-sm backdrop-blur dark:border-rose-300/20 dark:bg-white/8">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <Layers3 className="h-6 w-6" />
    </div>
    <h2 className="mt-4 text-base font-black text-foreground">아직 카드 풀이 비어 있습니다</h2>
    <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
      아레나 카드가 추가되면 이곳에서 팀 구도와 전투 흐름을 미리 살펴볼 수 있습니다.
    </p>
    <div className="mt-4 grid grid-cols-3 gap-2">
      {[
        ['카드', '비어 있음'],
        ['전투', '대기'],
        ['표시', '준비 후 공개']
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-secondary/60 px-3 py-2 text-center">
          <p className="text-[9px] font-black text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-[11px] font-black text-foreground">{value}</p>
        </div>
      ))}
    </div>
  </div>
);

const ArenaBattleShowcase: React.FC<{ cards: ArenaCard[] }> = ({ cards }) => {
  const left = cards.slice(0, 3);
  const right = cards.slice(1, 4).reverse();
  if (left.length < 3 || right.length < 3) return <ArenaEmptyShowcase />;

  return (
    <div className="arena-showcase rounded-[1.75rem] border border-white/70 p-4 shadow-sm backdrop-blur dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-primary">카드 조합 미리보기</p>
          <h2 className="mt-1 text-base font-black text-foreground">전투 미리보기</h2>
        </div>
        <span className="rounded-full bg-secondary/80 px-3 py-1 text-[10px] font-black text-muted-foreground">R3 · 2:1</span>
      </div>

      <div className="mt-4 grid gap-3">
        {[
          ['내 덱', left, 'from-rose-100 to-red-50 dark:from-rose-300/12 dark:to-red-300/8'],
          ['상대 덱', right, 'from-pink-100 to-rose-50 dark:from-pink-300/12 dark:to-rose-300/8']
        ].map(([label, items, tone]) => (
          <div key={String(label)} className={`arena-panel-soft rounded-3xl border border-white/70 bg-gradient-to-r ${tone} p-3 dark:border-white/10`}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-black text-muted-foreground">{String(label)}</p>
              <span className="text-[10px] font-black text-foreground">{(items as ArenaCard[]).length} 출전</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(items as ArenaCard[]).map((card) => (
                <div key={`${label}-${card.card_id}`} className="arena-showcase-card min-w-0 rounded-2xl bg-white/75 p-2 dark:bg-white/10">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                    {card.image_url ? <img src={card.image_url} alt={card.name} className="h-full w-full rounded-2xl object-cover" loading="lazy" /> : card.name.slice(0, 1)}
                  </div>
                  <p className="mt-1 truncate text-center text-[10px] font-black text-foreground">{card.class.name}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ['전술', '5R 플랜'],
          ['관전', '리플레이'],
          ['다시보기', '리플레이']
        ].map(([label, value]) => (
          <div key={label} className="arena-status-row rounded-2xl border border-transparent bg-secondary/60 px-3 py-2 text-center">
            <p className="text-[9px] font-black text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-[11px] font-black text-foreground">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};








