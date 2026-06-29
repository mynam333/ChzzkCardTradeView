export type ArenaRuleLikeClass = {
  id?: string;
  class_id?: string;
  name?: string;
  role?: string;
  description?: string;
};

export type ArenaRuleLikeSkill = {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
};

export type ArenaRuleStatKey = 'hp' | 'attack' | 'defense' | 'speed' | 'focus';

const normalizeKey = (value?: string | null) => String(value || '').trim().toLowerCase();

export const arenaStatDescriptions: Record<ArenaRuleStatKey, string> = {
  hp: '전투 중 버틸 수 있는 체력 총량입니다. 0이 되면 해당 라운드에서 리타이어하며, 회복 효과도 이 최대 체력을 기준으로 계산됩니다.',
  attack: '기본 공격과 직접 피해형 스킬의 중심 수치입니다. 높을수록 한 번의 공격으로 상대 체력을 깎는 압박력이 커집니다.',
  defense: '받는 피해를 줄이고 보호막, 전열 유지, 반격형 운영의 안정성을 높입니다. 집중 공격을 버티는 카드에게 특히 중요합니다.',
  speed: '행동 순서와 공격 템포에 관여합니다. 높을수록 먼저 행동하거나 다음 행동까지의 간격을 줄이는 전술과 잘 맞습니다.',
  focus: '스킬 발동 안정성, 에너지 흐름, 마법/지원/제어 계열 효과의 성능을 뒷받침합니다. 변수 창출형 카드의 핵심 수치입니다.'
};

export const arenaRoleLabels: Record<string, string> = {
  frontline: '전열',
  damage: '공격',
  control: '제어',
  support: '지원',
  tempo: '템포'
};

export const arenaRoleDescriptions: Record<string, string> = {
  frontline: '전열에서 피해를 받아내고 아군의 공격 시간을 벌어주는 역할입니다. 체력과 방어, 보호 계열 스킬을 함께 볼 때 강점이 드러납니다.',
  damage: '상대 핵심 카드를 빠르게 쓰러뜨리는 주 피해 역할입니다. 공격, 속도, 마무리형 스킬 조합을 통해 라운드 승리 조건을 앞당깁니다.',
  control: '둔화, 약화, 방어 붕괴, 행동 지연으로 상대 전술의 리듬을 끊는 역할입니다. 직접 피해보다 전투 흐름을 바꾸는 가치가 큽니다.',
  support: '회복, 보호막, 버프, 상태 완화로 팀 전체의 안정성을 높이는 역할입니다. 장기전과 5판 3선승 흐름에서 효율이 커집니다.',
  tempo: '행동 순서, 위치, 쿨타임, 집중 흐름을 조절해 라운드 주도권을 가져오는 역할입니다. 매 라운드 전술 변경과 잘 맞습니다.'
};

const classDescriptionsById: Record<string, string> = {
  shield_knight: '방패기사는 전열에서 도발과 보호막으로 공격을 받아내는 정석 수비 클래스입니다. 체력과 방어가 높을수록 팀 전체가 안정적으로 시간을 벌 수 있습니다.',
  iron_wall: '철벽수호자는 높은 방어와 피해 감소로 오래 버티는 장기전형 전열 클래스입니다. 빠른 승부보다 상대의 화력을 흘려내는 운영에 강합니다.',
  vanguard: '선봉대장은 전투 초반 주도권과 아군 보호를 동시에 노리는 전열 클래스입니다. 속도 보정과 보호 스킬을 섞어 첫 교전의 방향을 잡는 데 강합니다.',
  ward_keeper: '결계지기는 광역 보호막과 피해 분산으로 팀 생존을 보조하는 보호형 지원 클래스입니다. 한 카드만 버티는 것보다 진영 전체의 안정성을 올립니다.',
  duelist: '결투가는 같은 대상을 오래 압박해 단일 교전 우위를 만드는 브루저 클래스입니다. 표식, 연속 공격, 공격 스탯과 궁합이 좋습니다.',
  berserker: '폭주전사는 체력이 낮아질수록 공격적으로 몰아붙이는 고위험 공격 클래스입니다. 피해를 감수하고 강한 반격 타이밍을 만드는 카드에 어울립니다.',
  pursuer: '추격자는 약해진 적을 따라가 마무리 타이밍을 만드는 공격 클래스입니다. 낮은 체력 대상 우선 공격이나 처치 관여 효과와 잘 맞습니다.',
  breaker: '파쇄자는 보호막과 방어 태세를 깨고 전열 돌파를 담당하는 제어형 공격 클래스입니다. 수비 조합을 상대할 때 가치가 커집니다.',
  sniper: '저격수는 후열에서 표식과 치명타로 단일 화력을 누적하는 원거리 공격 클래스입니다. 보호받는 위치에서 오래 딜을 넣는 전술에 강합니다.',
  assassin: '암살자는 약한 후열을 빠르게 압박하는 속도형 공격 클래스입니다. 선공, 회피, 마무리 스킬로 짧은 교전을 노립니다.',
  rapid_gunner: '속사수는 빠른 기본 공격과 표식 연계로 지속 피해를 만드는 공격 클래스입니다. 한 방보다 잦은 타격과 속도 기반 운영에 강합니다.',
  executioner: '처형자는 낮은 체력 대상을 확실히 마무리하는 결정력 클래스입니다. 라운드 후반 처치 한 번으로 판세를 끝내는 역할에 적합합니다.',
  fire_mage: '화염술사는 광역 피해와 지속 압박으로 전장을 흔드는 캐스터 클래스입니다. 여러 대상을 동시에 약하게 만들고 누적 피해를 쌓습니다.',
  frost_mage: '서리술사는 둔화와 행동 방해로 상대 템포를 늦추는 제어 캐스터입니다. 먼저 때리는 것보다 상대가 제때 행동하지 못하게 만드는 데 강합니다.',
  storm_caller: '폭풍소환사는 연쇄 피해와 집중 흔들기로 변수를 만드는 캐스터 클래스입니다. 무작위성이 있지만 여러 대상에게 압박을 분산합니다.',
  curse_weaver: '저주술사는 약화와 취약 효과로 상대의 강점을 깎는 디버프 클래스입니다. 강한 상대 카드를 덜 위협적으로 만드는 데 초점이 있습니다.',
  healer: '치유사는 회복과 생존 보조로 세트 안정성을 높이는 지원 클래스입니다. 장기전에서 전열이 무너지지 않게 유지하는 데 강합니다.',
  bard: '음유지원가는 버프와 에너지 흐름을 보조해 팀 템포를 끌어올리는 지원 클래스입니다. 직접 피해보다 아군 행동 효율을 높입니다.',
  tactician: '전술가는 집중 공격과 배치 운영으로 라운드 플랜을 강화하는 템포 클래스입니다. 매 라운드 선택을 바꾸는 운영에서 가치가 큽니다.',
  purifier: '정화자는 디버프 완화와 상태 저항으로 안정적인 전투를 돕는 지원 클래스입니다. 제어 조합을 상대할 때 팀의 흔들림을 줄입니다.',
  trapper: '함정공은 시간차 함정과 방해 효과로 상대 진형을 흔드는 템포 클래스입니다. 즉시 피해보다 다음 행동을 꼬이게 만드는 데 강합니다.',
  illusionist: '환영술사는 회피와 환영성 교란으로 예측을 어렵게 만드는 템포 클래스입니다. 첫 피격 회피나 순서 교란으로 상대 계산을 어긋나게 합니다.',
  disruptor: '교란자는 침묵과 에너지 감소로 핵심 스킬 타이밍을 방해하는 제어 클래스입니다. 궁극기나 액티브 의존도가 높은 상대에게 강합니다.',
  switcher: '위치술사는 위치 교환과 이동 변수로 전열과 후열 구도를 바꾸는 템포 클래스입니다. 배치 싸움의 의미를 크게 만드는 카드입니다.'
};

const classDescriptionsByName: Record<string, string> = Object.fromEntries([
  ['방패기사', classDescriptionsById.shield_knight],
  ['철벽수호자', classDescriptionsById.iron_wall],
  ['선봉대장', classDescriptionsById.vanguard],
  ['결계지기', classDescriptionsById.ward_keeper],
  ['결투가', classDescriptionsById.duelist],
  ['폭주전사', classDescriptionsById.berserker],
  ['추격자', classDescriptionsById.pursuer],
  ['파쇄자', classDescriptionsById.breaker],
  ['저격수', classDescriptionsById.sniper],
  ['암살자', classDescriptionsById.assassin],
  ['속사수', classDescriptionsById.rapid_gunner],
  ['처형자', classDescriptionsById.executioner],
  ['화염술사', classDescriptionsById.fire_mage],
  ['서리술사', classDescriptionsById.frost_mage],
  ['폭풍소환사', classDescriptionsById.storm_caller],
  ['저주술사', classDescriptionsById.curse_weaver],
  ['치유사', classDescriptionsById.healer],
  ['음유지원가', classDescriptionsById.bard],
  ['전술가', classDescriptionsById.tactician],
  ['정화자', classDescriptionsById.purifier],
  ['함정공', classDescriptionsById.trapper],
  ['환영술사', classDescriptionsById.illusionist],
  ['교란자', classDescriptionsById.disruptor],
  ['위치술사', classDescriptionsById.switcher]
].map(([name, description]) => [normalizeKey(name), description]));

const skillDescriptionsById: Record<string, string> = {
  'aegis-pop': '가장 피해를 많이 받은 아군에게 짧은 보호막을 부여합니다. 전열이 버티는 시간을 늘리고 집중 공격을 한 번 흘려내는 액티브 스킬입니다.',
  'soft-taunt': '첫 교전에서 자신이 받는 피해 일부를 줄이고 전열 대상 확률을 높입니다. 상대 공격을 끌어와 팀원을 보호하는 패시브 스킬입니다.',
  'last-cookie': '체력이 낮을 때 한 번 회복하고 방어력을 잠시 올립니다. 리타이어 직전의 전열 카드를 한 번 더 버티게 하는 궁극기입니다.',
  'ribbon-wall': '전열 아군에게 작은 보호막을 나누어 부여합니다. 한 명만 보호하는 대신 전열 전체의 생존선을 올리는 액티브 스킬입니다.',
  'sturdy-promise': '라운드 후반에 방어 효율이 소폭 증가합니다. 시간이 길어질수록 전열 유지력이 좋아지는 패시브 스킬입니다.',
  'neon-sting': '표식이 있는 적에게 추가 피해를 주는 빠른 공격입니다. 집중 공격 대상에게 순간 피해를 더하는 액티브 스킬입니다.',
  rivalry: '매 라운드 첫 공격 대상에게 집중 표식을 남깁니다. 같은 대상을 계속 압박하는 결투형 운영을 돕는 패시브 스킬입니다.',
  'clutch-cut': '체력이 낮은 적에게 강한 마무리 피해를 줍니다. 라운드 후반 킬 결정력을 높이는 궁극기입니다.',
  'pink-rush': '짧은 시간 공격 템포를 끌어올립니다. 빠르게 타격 횟수를 늘려 초반 압박을 만드는 액티브 스킬입니다.',
  'one-more-hit': '처치 관여 후 다음 공격의 피해가 소폭 증가합니다. 연속 마무리 흐름을 노리는 패시브 스킬입니다.',
  'star-orbit': '무작위 적 둘에게 작은 마법 피해와 집중 감소를 적용합니다. 여러 적의 스킬 흐름을 동시에 흔드는 액티브 스킬입니다.',
  'focus-lens': '스킬 사용 후 다음 기본 공격의 명중 안정성이 증가합니다. 스킬과 기본 공격을 매끄럽게 잇는 패시브 스킬입니다.',
  'quiet-comet': '짧은 지연 후 가장 약한 적에게 큰 마법 피해를 줍니다. 후반에 약한 대상을 마무리하는 캐스터 궁극기입니다.',
  'puzzle-spark': '적 하나의 행동 흐름을 짧게 늦춥니다. 상대 핵심 카드의 행동 타이밍을 밀어내는 액티브 제어 스킬입니다.',
  'mana-ribbon': '스킬 사용에 필요한 집중 흐름을 안정화합니다. 스킬 발동 편차를 줄이는 캐스터형 패시브 스킬입니다.',
  'mint-arrow': '후열에서 적 하나를 공격하고 표식을 남깁니다. 원거리 카드가 다음 집중 공격의 기준점을 만드는 액티브 스킬입니다.',
  'steady-breath': '라운드가 길어질수록 공격 속도가 소폭 증가합니다. 긴 교전에서 지속 화력을 높이는 패시브 스킬입니다.',
  'rain-shot': '여러 적에게 낮은 피해를 나누어 주고 표식 대상을 우선합니다. 다수 타격으로 전장 전체를 압박하는 궁극기입니다.',
  'sky-snipe': '후열 대상을 우선 공격합니다. 보호받는 딜러나 지원 카드를 직접 압박하는 액티브 스킬입니다.',
  'calm-aim': '같은 대상을 오래 공격할수록 치명 확률이 소폭 증가합니다. 단일 대상 집중전에서 가치가 커지는 패시브 스킬입니다.',
  'mirror-step': '짧은 회피 상태가 되고 다음 공격 피해를 조금 올립니다. 생존과 반격을 동시에 노리는 액티브 스킬입니다.',
  'confetti-fake': '첫 피격 시 일정 확률로 피해 일부를 무효화합니다. 암살이나 기습 피해를 한 번 흘리는 패시브 스킬입니다.',
  'shuffle-stage': '적의 행동 순서를 한 번 흔들고 아군의 속도를 보정합니다. 라운드 템포를 크게 바꾸는 궁극기입니다.',
  'wink-escape': '위험한 순간 짧게 피해를 줄입니다. 빠른 카드가 급사를 피하고 다음 행동을 이어가게 하는 액티브 스킬입니다.',
  'tiny-trap': '첫 교전 대상의 템포를 낮출 확률이 있습니다. 상대 첫 행동 흐름을 망가뜨리는 패시브 함정 스킬입니다.',
  'bubble-tea': '가장 체력이 낮은 아군을 회복하고 집중을 조금 올립니다. 생존과 스킬 흐름을 동시에 보정하는 액티브 지원 스킬입니다.',
  'team-chant': '전투 시작 시 아군 전체의 방어 또는 속도 중 하나를 소폭 올립니다. 팀 전체 초반 안정성을 높이는 패시브 스킬입니다.',
  'cozy-finale': '아군 전체에게 짧은 보호막을 부여합니다. 광역 피해나 마무리 타이밍을 한 번 버티게 하는 지원 궁극기입니다.',
  'snack-break': '아군 하나를 회복하고 에너지 흐름을 조금 보정합니다. 핵심 카드가 다음 스킬까지 버티도록 돕는 액티브 스킬입니다.',
  'warm-light': '후열 아군의 생존력을 소폭 올립니다. 딜러와 지원 카드가 기습에 버티도록 돕는 패시브 스킬입니다.',
  'crack-pop': '보호막 또는 방어 증가 효과가 있는 적에게 추가 피해를 줍니다. 수비형 전열을 깨기 위한 액티브 스킬입니다.',
  'guard-pierce': '방어형 대상에게 주는 피해가 소폭 증가합니다. 전열 돌파력을 꾸준히 높이는 패시브 스킬입니다.',
  'candy-hammer': '전열 적에게 큰 피해를 주고 짧게 행동을 늦춥니다. 단단한 앞줄을 무너뜨리는 파쇄형 궁극기입니다.',
  'armor-melt': '방어가 높은 대상의 방어 효율을 낮춥니다. 이후 아군 피해가 더 잘 들어가게 만드는 액티브 디버프 스킬입니다.',
  'front-cracker': '전열을 공격할 때 피해 편차가 줄어듭니다. 안정적으로 앞줄을 깎는 패시브 스킬입니다.',
  'clock-hop': '아군 하나의 다음 행동을 앞당깁니다. 중요한 공격이나 회복 타이밍을 먼저 가져오는 액티브 템포 스킬입니다.',
  'tempo-pocket': '라운드 시작 시 집중을 추가로 확보할 확률이 있습니다. 초반 스킬 발동 가능성을 높이는 패시브 스킬입니다.',
  'rewind-cue': '아군 주요 스킬의 재사용 대기 흐름을 한 번 보정합니다. 팀의 핵심 스킬 주기를 다시 당기는 궁극기입니다.',
  'fast-count': '초반 행동 순서를 앞당깁니다. 첫 교전에서 먼저 공격하거나 보호를 걸어 라운드 주도권을 잡는 액티브 스킬입니다.',
  'beat-shift': '라운드 흐름에 따라 속도와 집중 중 하나를 보정합니다. 상황에 맞춰 행동 템포를 자동 보완하는 패시브 스킬입니다.'
};

const skillDescriptionsByName: Record<string, string> = Object.fromEntries([
  ['방울 방패', skillDescriptionsById['aegis-pop']],
  ['말랑 도발', skillDescriptionsById['soft-taunt']],
  ['마지막 쿠키', skillDescriptionsById['last-cookie']],
  ['리본 장벽', skillDescriptionsById['ribbon-wall']],
  ['든든한 약속', skillDescriptionsById['sturdy-promise']],
  ['네온 찌르기', skillDescriptionsById['neon-sting']],
  ['라이벌 선언', skillDescriptionsById.rivalry],
  ['클러치 컷', skillDescriptionsById['clutch-cut']],
  ['핑크 러시', skillDescriptionsById['pink-rush']],
  ['한 번 더', skillDescriptionsById['one-more-hit']],
  ['별빛 궤도', skillDescriptionsById['star-orbit']],
  ['집중 렌즈', skillDescriptionsById['focus-lens']],
  ['고요한 혜성', skillDescriptionsById['quiet-comet']],
  ['퍼즐 스파크', skillDescriptionsById['puzzle-spark']],
  ['마나 리본', skillDescriptionsById['mana-ribbon']],
  ['민트 화살', skillDescriptionsById['mint-arrow']],
  ['차분한 호흡', skillDescriptionsById['steady-breath']],
  ['소나기 사격', skillDescriptionsById['rain-shot']],
  ['하늘 저격', skillDescriptionsById['sky-snipe']],
  ['고요한 조준', skillDescriptionsById['calm-aim']],
  ['거울 발걸음', skillDescriptionsById['mirror-step']],
  ['종이꽃 페이크', skillDescriptionsById['confetti-fake']],
  ['셔플 스테이지', skillDescriptionsById['shuffle-stage']],
  ['윙크 회피', skillDescriptionsById['wink-escape']],
  ['작은 함정', skillDescriptionsById['tiny-trap']],
  ['버블티 충전', skillDescriptionsById['bubble-tea']],
  ['응원 구호', skillDescriptionsById['team-chant']],
  ['포근한 피날레', skillDescriptionsById['cozy-finale']],
  ['간식 시간', skillDescriptionsById['snack-break']],
  ['따뜻한 조명', skillDescriptionsById['warm-light']],
  ['톡톡 균열', skillDescriptionsById['crack-pop']],
  ['가드 피어스', skillDescriptionsById['guard-pierce']],
  ['캔디 해머', skillDescriptionsById['candy-hammer']],
  ['아머 멜트', skillDescriptionsById['armor-melt']],
  ['전열 크래커', skillDescriptionsById['front-cracker']],
  ['시계 토끼뜀', skillDescriptionsById['clock-hop']],
  ['템포 주머니', skillDescriptionsById['tempo-pocket']],
  ['리와인드 큐', skillDescriptionsById['rewind-cue']],
  ['빠른 카운트', skillDescriptionsById['fast-count']],
  ['비트 전환', skillDescriptionsById['beat-shift']]
].map(([name, description]) => [normalizeKey(name), description]));

export const getArenaClassDescription = (cardClass: ArenaRuleLikeClass) => {
  const idDescription = classDescriptionsById[normalizeKey(cardClass.class_id || cardClass.id)];
  if (idDescription) return idDescription;
  const nameDescription = classDescriptionsByName[normalizeKey(cardClass.name)];
  if (nameDescription) return nameDescription;
  if (cardClass.description) return cardClass.description;
  return arenaRoleDescriptions[normalizeKey(cardClass.role)] || '카드의 전투 포지션과 라운드 운영 성향을 결정하는 클래스입니다.';
};

export const getArenaSkillDescription = (skill: ArenaRuleLikeSkill) => {
  const idDescription = skillDescriptionsById[normalizeKey(skill.id)];
  if (idDescription) return idDescription;
  const nameDescription = skillDescriptionsByName[normalizeKey(skill.name)];
  if (nameDescription) return nameDescription;
  if (skill.description) return skill.description;
  return '라운드 중 조건과 카드 역할에 따라 발동되는 스킬입니다. 세부 효과는 카드 클래스와 스탯 조합에 따라 전투 로그에 반영됩니다.';
};
