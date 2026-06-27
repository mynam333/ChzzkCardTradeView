import type {
  ArenaMatchViewDto,
  ArenaReplayEventDto,
  ArenaReplayPayloadDto,
  ArenaReplayUnitStateDto,
  ArenaRulesCatalogDto,
  ArenaSnapshotCardDto
} from '@chikapo/arena-contract';

export const ARENA_VFX_PREVIEW_MATCH_ID = '__arena_vfx_preview__';

export type ArenaVfxPreviewKind = 'attack' | 'skill' | 'ultimate' | 'heal' | 'guard' | 'control' | 'burn' | 'poison' | 'tempo' | 'retire';

export const ARENA_VFX_PREVIEW_OPTIONS: Array<{
  value: ArenaVfxPreviewKind;
  label: string;
  description: string;
}> = [
  { value: 'attack', label: '기본 공격', description: '카드 돌진, 충돌, 슬래시 타격감을 확인합니다.' },
  { value: 'skill', label: '스킬', description: '투사체와 대상 폭발, 스킬 발동 문구를 확인합니다.' },
  { value: 'ultimate', label: '궁극기', description: '큰 링, 플래시, 강한 히트스톱을 확인합니다.' },
  { value: 'heal', label: '회복', description: '상승 입자와 회복 숫자 표시를 확인합니다.' },
  { value: 'guard', label: '보호', description: '보호막 돔, 실드 배지, 파란 계열 VFX를 확인합니다.' },
  { value: 'control', label: '제어', description: '속박선, 룬 링, 제어 상태 강조를 확인합니다.' },
  { value: 'burn', label: '화상', description: '불꽃 잔상과 지속 피해 느낌을 확인합니다.' },
  { value: 'poison', label: '중독', description: '녹색 잔류 입자와 디버프성 피해를 확인합니다.' },
  { value: 'tempo', label: '템포', description: '속도선과 차례 가속 느낌을 확인합니다.' },
  { value: 'retire', label: '전투불능', description: '마무리 타격과 전투불능 표시를 확인합니다.' }
];

export type ArenaPreviewRuleClass = {
  id: string;
  class_id: string;
  name: string;
  description: string;
  role: string;
};

export type ArenaPreviewRuleSkill = {
  id: string;
  name: string;
  type: string;
  description: string;
};

export const ARENA_PREVIEW_PLAYER_CARDS: ArenaSnapshotCardDto[] = [
  { card_id: 'preview-player-striker', channel_id: 'preview-player-striker', name: '로즈 스트라이커', image_url: '/arena-icon.png', class_id: 'duelist', class_name: '결투가', stats: { hp: 900, attack: 190, defense: 70, speed: 145, focus: 105 }, skills: [{ id: 'preview-quick-slash', name: '꽃잎 베기', type: 'active' }, { id: 'preview-brave-heart', name: '승부 감각', type: 'passive' }, { id: 'preview-rose-burst', name: '로즈 버스트', type: 'ultimate' }] },
  { card_id: 'preview-player-guard', channel_id: 'preview-player-guard', name: '쿠션 가드', image_url: '/arena-icon.png', class_id: 'guardian', class_name: '수호자', stats: { hp: 1080, attack: 120, defense: 165, speed: 80, focus: 85 }, skills: [{ id: 'preview-soft-wall', name: '말랑 방벽', type: 'active' }, { id: 'preview-guard-stance', name: '버팀 자세', type: 'passive' }, { id: 'preview-safe-zone', name: '세이프 존', type: 'ultimate' }] },
  { card_id: 'preview-player-healer', channel_id: 'preview-player-healer', name: '하트 서포터', image_url: '/arena-icon.png', class_id: 'support', class_name: '서포터', stats: { hp: 820, attack: 95, defense: 95, speed: 120, focus: 170 }, skills: [{ id: 'preview-heart-pulse', name: '하트 펄스', type: 'active' }, { id: 'preview-kind-aura', name: '응원 오라', type: 'passive' }, { id: 'preview-full-cheer', name: '풀 치어링', type: 'ultimate' }] },
  { card_id: 'preview-player-controller', channel_id: 'preview-player-controller', name: '리본 컨트롤러', image_url: '/arena-icon.png', class_id: 'controller', class_name: '제어술사', stats: { hp: 790, attack: 110, defense: 85, speed: 125, focus: 175 }, skills: [{ id: 'preview-ribbon-bind', name: '리본 바인드', type: 'active' }, { id: 'preview-calm-read', name: '흐름 읽기', type: 'passive' }, { id: 'preview-lock-stage', name: '락 스테이지', type: 'ultimate' }] },
  { card_id: 'preview-player-tempo', channel_id: 'preview-player-tempo', name: '템포 메이커', image_url: '/arena-icon.png', class_id: 'runner', class_name: '러너', stats: { hp: 760, attack: 135, defense: 72, speed: 188, focus: 118 }, skills: [{ id: 'preview-tempo-lift', name: '템포 리프트', type: 'active' }, { id: 'preview-first-beat', name: '첫 박자', type: 'passive' }, { id: 'preview-overdrive', name: '오버드라이브', type: 'ultimate' }] },
  { card_id: 'preview-player-mage', channel_id: 'preview-player-mage', name: '캔디 메이지', image_url: '/arena-icon.png', class_id: 'mage', class_name: '마도사', stats: { hp: 740, attack: 172, defense: 62, speed: 112, focus: 182 }, skills: [{ id: 'preview-candy-bolt', name: '캔디 볼트', type: 'active' }, { id: 'preview-sweet-mark', name: '스위트 마크', type: 'passive' }, { id: 'preview-starfall', name: '스타폴', type: 'ultimate' }] }
];

export const ARENA_PREVIEW_OPPONENT_CARDS: ArenaSnapshotCardDto[] = [
  { card_id: 'preview-bot-front', channel_id: 'preview-bot-front', name: '상대 전열 A', image_url: '/arena-icon.png', class_id: 'guardian', class_name: '수호자', stats: { hp: 980, attack: 130, defense: 130, speed: 86, focus: 94 }, skills: [{ id: 'preview-counter-hit', name: '맞받기', type: 'active' }, { id: 'preview-tough', name: '단단함', type: 'passive' }, { id: 'preview-last-wall', name: '최후의 벽', type: 'ultimate' }] },
  { card_id: 'preview-bot-center', channel_id: 'preview-bot-center', name: '상대 전열 B', image_url: '/arena-icon.png', class_id: 'duelist', class_name: '결투가', stats: { hp: 860, attack: 170, defense: 78, speed: 132, focus: 108 }, skills: [{ id: 'preview-fast-cut', name: '패스트 컷', type: 'active' }, { id: 'preview-rivalry', name: '라이벌리', type: 'passive' }, { id: 'preview-finish-cut', name: '피니시 컷', type: 'ultimate' }] },
  { card_id: 'preview-bot-side', channel_id: 'preview-bot-side', name: '상대 전열 C', image_url: '/arena-icon.png', class_id: 'support', class_name: '서포터', stats: { hp: 830, attack: 105, defense: 92, speed: 118, focus: 152 }, skills: [{ id: 'preview-aid', name: '응급 지원', type: 'active' }, { id: 'preview-encourage', name: '격려', type: 'passive' }, { id: 'preview-recover-all', name: '전체 회복', type: 'ultimate' }] },
  { card_id: 'preview-bot-back-a', channel_id: 'preview-bot-back-a', name: '상대 후열 A', image_url: '/arena-icon.png', class_id: 'mage', class_name: '마도사', stats: { hp: 720, attack: 180, defense: 60, speed: 108, focus: 188 }, skills: [{ id: 'preview-fire-dot', name: '불씨', type: 'active' }, { id: 'preview-ember', name: '잔불', type: 'passive' }, { id: 'preview-meteor', name: '메테오', type: 'ultimate' }] },
  { card_id: 'preview-bot-back-b', channel_id: 'preview-bot-back-b', name: '상대 후열 B', image_url: '/arena-icon.png', class_id: 'trickster', class_name: '트릭스터', stats: { hp: 760, attack: 140, defense: 70, speed: 158, focus: 140 }, skills: [{ id: 'preview-poison-pop', name: '포이즌 팝', type: 'active' }, { id: 'preview-misdirect', name: '미스디렉트', type: 'passive' }, { id: 'preview-trick-finale', name: '트릭 피날레', type: 'ultimate' }] },
  { card_id: 'preview-bot-back-c', channel_id: 'preview-bot-back-c', name: '상대 후열 C', image_url: '/arena-icon.png', class_id: 'runner', class_name: '러너', stats: { hp: 780, attack: 132, defense: 74, speed: 184, focus: 116 }, skills: [{ id: 'preview-dash', name: '대시', type: 'active' }, { id: 'preview-run-up', name: '런 업', type: 'passive' }, { id: 'preview-blitz', name: '블리츠', type: 'ultimate' }] }
];

type ArenaPreviewRoundSlot = {
  card_id: string;
  row: 0 | 1;
  col: 0 | 1 | 2;
};

const ARENA_PREVIEW_SLOT_TEMPLATE: ArenaPreviewRoundSlot[] = [
  { card_id: '', row: 1, col: 0 },
  { card_id: '', row: 1, col: 1 },
  { card_id: '', row: 1, col: 2 },
  { card_id: '', row: 0, col: 0 },
  { card_id: '', row: 0, col: 1 },
  { card_id: '', row: 0, col: 2 }
];

export const buildArenaPreviewSlots = (cards: ArenaSnapshotCardDto[]): ArenaPreviewRoundSlot[] =>
  ARENA_PREVIEW_SLOT_TEMPLATE
    .map((slot, index) => ({ ...slot, card_id: cards[index]?.card_id || '' }))
    .filter((slot) => slot.card_id);

export const arenaPreviewUnitStatesFor = (kind: ArenaVfxPreviewKind): ArenaReplayUnitStateDto[] => {
  const playerCards = ARENA_PREVIEW_PLAYER_CARDS.map((card) => ({
    id: card.card_id,
    side: 'player' as const,
    card_id: card.card_id,
    channel_id: card.channel_id,
    max_hp: card.stats?.hp || 800,
    start_hp: card.stats?.hp || 800,
    final_hp: kind === 'heal' && card.card_id === 'preview-player-striker' ? 900 : card.stats?.hp || 800,
    alive: true
  }));
  const opponentCards = ARENA_PREVIEW_OPPONENT_CARDS.map((card) => ({
    id: card.card_id,
    side: 'bot' as const,
    card_id: card.card_id,
    channel_id: card.channel_id,
    max_hp: card.stats?.hp || 800,
    start_hp: card.stats?.hp || 800,
    final_hp: kind === 'retire' && card.card_id === 'preview-bot-center' ? 0 : Math.max(1, (card.stats?.hp || 800) - (kind === 'ultimate' ? 420 : 180)),
    alive: !(kind === 'retire' && card.card_id === 'preview-bot-center')
  }));
  return [...playerCards, ...opponentCards];
};

const previewEvent = (event: ArenaReplayEventDto): ArenaReplayEventDto => event;

export const buildArenaPreviewEvents = (kind: ArenaVfxPreviewKind): ArenaReplayEventDto[] => {
  const attacker = kind === 'heal' ? 'preview-player-healer' : kind === 'guard' ? 'preview-player-guard' : kind === 'control' ? 'preview-player-controller' : kind === 'tempo' ? 'preview-player-tempo' : kind === 'ultimate' ? 'preview-player-mage' : 'preview-player-striker';
  const target = kind === 'heal' || kind === 'guard' || kind === 'tempo' ? 'preview-player-striker' : 'preview-bot-center';
  const start = previewEvent({ t: 0, type: 'ROUND_START', actor: attacker, targets: [target], message: 'VFX 프리뷰 라운드 시작' });
  const baseCast = {
    actor: attacker,
    targets: [target],
    vfx_kind: kind,
    effect_tags: [kind],
    message: ARENA_VFX_PREVIEW_OPTIONS.find((option) => option.value === kind)?.label || 'VFX 프리뷰'
  } satisfies Partial<ArenaReplayEventDto>;

  if (kind === 'attack') {
    return [
      start,
      previewEvent({ t: 520, type: 'BASIC_ATTACK', ...baseCast, vfx_kind: 'attack', damage_type: 'physical', value: 180 }),
      previewEvent({ t: 520, type: 'DAMAGE', actor: attacker, targets: [target], value: 180, hp_before: 860, hp_after: 680, damage_type: 'physical', vfx_kind: 'attack', message: '정확한 카드 표면 타격' })
    ];
  }

  if (kind === 'heal') {
    return [
      start,
      previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: 'preview-heart-pulse', skill_type: 'active', damage_type: 'heal', value: 260 }),
      previewEvent({ t: 520, type: 'HEAL', actor: attacker, targets: [target], value: 260, hp_before: 640, hp_after: 900, damage_type: 'heal', vfx_kind: 'heal', message: '회복 링과 상승 입자' })
    ];
  }

  if (kind === 'guard') {
    return [
      start,
      previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: 'preview-soft-wall', skill_type: 'active', damage_type: 'shield', value: 240 }),
      previewEvent({ t: 520, type: 'SHIELD_GAIN', actor: attacker, targets: [target], value: 240, shield_before: 0, shield_after: 240, damage_type: 'shield', vfx_kind: 'guard', message: '보호막 돔 전개' })
    ];
  }

  if (kind === 'control') {
    return [
      start,
      previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: 'preview-ribbon-bind', skill_type: 'active', damage_type: 'control', value: 1, effect_tags: ['control', 'bind', 'delay'] }),
      previewEvent({ t: 520, type: 'DAMAGE', actor: attacker, targets: [target], value: 80, hp_before: 860, hp_after: 780, damage_type: 'control', vfx_kind: 'control', effect_tags: ['bind'], message: '구속선과 짧은 흔들림' })
    ];
  }

  if (kind === 'tempo') {
    return [
      start,
      previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: 'preview-tempo-lift', skill_type: 'active', damage_type: 'control', value: 1, effect_tags: ['tempo', 'haste'], message: '템포 상승' }),
      previewEvent({ t: 520, type: 'BUFF_GAIN', actor: attacker, targets: [target], value: 1, vfx_kind: 'tempo', effect_tags: ['haste'], message: '다음 행동을 앞당기는 속도선' })
    ];
  }

  if (kind === 'burn' || kind === 'poison') {
    const isBurn = kind === 'burn';
    return [
      start,
      previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: isBurn ? 'preview-candy-bolt' : 'preview-poison-pop', skill_type: 'active', damage_type: 'magic', value: isBurn ? 130 : 95, effect_tags: [kind, 'dot'], message: isBurn ? '화상 부여' : '중독 부여' }),
      previewEvent({ t: 520, type: 'DAMAGE', actor: attacker, targets: [target], value: isBurn ? 130 : 95, hp_before: 860, hp_after: isBurn ? 730 : 765, damage_type: 'magic', vfx_kind: kind, effect_tags: [kind, 'dot'], message: isBurn ? '불꽃 잔류 피해' : '중독 잔류 피해' })
    ];
  }

  if (kind === 'retire') {
    return [
      start,
      previewEvent({ t: 520, type: 'BASIC_ATTACK', ...baseCast, vfx_kind: 'attack', damage_type: 'physical', value: 420 }),
      previewEvent({ t: 520, type: 'DAMAGE', actor: attacker, targets: [target], value: 420, hp_before: 390, hp_after: 0, alive_after: false, damage_type: 'physical', vfx_kind: 'retire', message: '마무리 타격' }),
      previewEvent({ t: 520, type: 'DEATH', actor: target, targets: [target], value: 0, hp_before: 0, hp_after: 0, alive_after: false, vfx_kind: 'retire', message: '전투불능' })
    ];
  }

  return [
    start,
    previewEvent({ t: 520, type: 'SKILL_CAST', ...baseCast, skill_id: kind === 'ultimate' ? 'preview-starfall' : 'preview-candy-bolt', skill_type: kind === 'ultimate' ? 'ultimate' : 'active', damage_type: 'magic', value: kind === 'ultimate' ? 420 : 240 }),
    previewEvent({ t: 520, type: 'DAMAGE', actor: attacker, targets: [target], value: kind === 'ultimate' ? 420 : 240, hp_before: 860, hp_after: kind === 'ultimate' ? 440 : 620, damage_type: 'magic', vfx_kind: kind, effect_tags: [kind === 'ultimate' ? 'finisher' : 'projectile'], message: kind === 'ultimate' ? '대형 궁극기 충격' : '투사체와 대상 폭발' })
  ];
};

export const buildArenaPreviewMatch = (
  kind: ArenaVfxPreviewKind,
  runId = 1,
  id = `arena-vfx-preview-${kind}-${runId}`
): ArenaMatchViewDto => ({
  id,
  result: 'win',
  match_type: 'BOT_PRACTICE',
  round_count: 1,
  player_a_round_wins: 1,
  player_b_round_wins: 0,
  difficulty: 'vfx-preview',
  created_at: '2026-01-01T00:00:00.000Z',
  summary: {
    progress_status: 'completed',
    current_round_no: 1,
    rounds_to_win: 1,
    max_rounds: 1,
    round_results: [{ round_no: 1, winner_side: 'player', player_remaining_units: kind === 'heal' || kind === 'guard' ? 6 : 5, bot_remaining_units: kind === 'retire' ? 5 : 6 }],
    player_deck: { deck_id: 'preview-player-deck', name: 'VFX 프리뷰 덱', cards: ARENA_PREVIEW_PLAYER_CARDS, round_plans: [{ round_no: 1, slots: buildArenaPreviewSlots(ARENA_PREVIEW_PLAYER_CARDS) }] },
    bot_deck: { deck_id: 'preview-bot-deck', name: 'VFX 프리뷰 상대', cards: ARENA_PREVIEW_OPPONENT_CARDS, round_plans: [{ round_no: 1, slots: buildArenaPreviewSlots(ARENA_PREVIEW_OPPONENT_CARDS) }] },
    battlefield_rule: { id: 'preview-field', name: '프리뷰 전장', description: '전투 VFX 검수 전용 로컬 전장입니다.' }
  }
});

export const buildArenaPreviewReplay = (
  kind: ArenaVfxPreviewKind,
  matchId = ARENA_VFX_PREVIEW_MATCH_ID
): ArenaReplayPayloadDto => ({
  match_id: matchId,
  match_format: 'best_of_five',
  rounds_to_win: 3,
  replay_version: 2,
  replay_storage: 'local_preview_tick_events',
  rounds: [{
    round_no: 1,
    duration_ms: 1800,
    winner_side: 'player',
    unit_states: arenaPreviewUnitStatesFor(kind),
    events: buildArenaPreviewEvents(kind)
  }]
});

const ARENA_PREVIEW_RULE_CLASSES: ArenaPreviewRuleClass[] = [
  { id: 'duelist', class_id: 'duelist', name: '결투가', description: '대상에게 빠르게 접근해 단일 타격을 넣습니다.', role: 'attack' },
  { id: 'guardian', class_id: 'guardian', name: '수호자', description: '보호막과 전열 유지에 강합니다.', role: 'tank' },
  { id: 'support', class_id: 'support', name: '서포터', description: '회복과 보조 효과로 라운드를 안정화합니다.', role: 'support' },
  { id: 'controller', class_id: 'controller', name: '제어술사', description: '상대 행동 흐름을 늦추고 묶습니다.', role: 'control' },
  { id: 'runner', class_id: 'runner', name: '러너', description: '빠른 템포와 행동 순서 장악에 특화됩니다.', role: 'speed' },
  { id: 'mage', class_id: 'mage', name: '마도사', description: '투사체와 강한 스킬 피해를 사용합니다.', role: 'magic' },
  { id: 'trickster', class_id: 'trickster', name: '트릭스터', description: '중독과 교란 효과로 상대를 흔듭니다.', role: 'debuff' }
];

const ARENA_PREVIEW_RULE_SKILLS: ArenaPreviewRuleSkill[] = [...ARENA_PREVIEW_PLAYER_CARDS, ...ARENA_PREVIEW_OPPONENT_CARDS]
  .flatMap((card) => card.skills || [])
  .map((skill) => ({ id: skill.id, name: skill.name, type: skill.type, description: `${skill.name} 프리뷰용 스킬입니다.` }));

export const ARENA_PREVIEW_RULES_CATALOG: ArenaRulesCatalogDto = {
  version: 'arena-preview-v1',
  classes: ARENA_PREVIEW_RULE_CLASSES,
  skills: ARENA_PREVIEW_RULE_SKILLS,
  tactic_chips: [],
  battlefield_rules: [{ id: 'preview-field', name: '프리뷰 전장', description: '전투 VFX 검수 전용 로컬 전장입니다.' }]
};

export const ARENA_PREVIEW_CLASS_LOOKUP = new Map<string, ArenaPreviewRuleClass>(
  ARENA_PREVIEW_RULE_CLASSES.flatMap((cardClass) => {
    const keys = [cardClass.id, cardClass.class_id].filter(Boolean);
    return keys.map((key: string) => [key, cardClass] as const);
  })
);

export const ARENA_PREVIEW_SKILL_LOOKUP = new Map<string, ArenaPreviewRuleSkill>(
  ARENA_PREVIEW_RULE_SKILLS.map((skill) => [skill.id, skill])
);

export const ARENA_PREVIEW_LOADOUT = {
  user_id: 'arena-vfx-preview',
  border_item_id: null,
  name_effect_item_id: null,
  border_item: null,
  name_effect_item: null
};
