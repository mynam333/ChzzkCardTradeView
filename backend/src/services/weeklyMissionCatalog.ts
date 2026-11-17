import crypto from 'crypto';

export type WeeklyMissionDifficulty = 'easy' | 'normal' | 'hard';

export type WeeklyMissionCondition =
  | { kind: 'event_value'; event_type: string; target: number; label: string }
  | { kind: 'event_count'; event_type: string; target: number; label: string }
  | { kind: 'distinct_source'; event_type: string; target: number; label: string }
  | { kind: 'distinct_metadata'; event_type: string; metadata_key: string; target: number; label: string }
  | { kind: 'active_days'; event_type: string; target: number; label: string };

export type WeeklyMissionTemplate = {
  code: string;
  difficulty: WeeklyMissionDifficulty;
  families: string[];
  title: string;
  description: string;
  conditions: WeeklyMissionCondition[];
};

export const WEEKLY_MISSION_CATALOG_VERSION = 1;

const condition = {
  attendance: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_source', event_type: 'login.daily', target, label: `${target}일 출석` }),
  minigame: (target: number): WeeklyMissionCondition => ({ kind: 'event_count', event_type: 'minigame.success', target, label: `미니게임 ${target}회 성공` }),
  minigameVariety: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_metadata', event_type: 'minigame.success', metadata_key: 'game_type', target, label: `서로 다른 미니게임 ${target}종 성공` }),
  minigameDays: (target: number): WeeklyMissionCondition => ({ kind: 'active_days', event_type: 'minigame.success', target, label: `${target}일 동안 미니게임 성공` }),
  draw: (target: number): WeeklyMissionCondition => ({ kind: 'event_value', event_type: 'card.acquired', target, label: `카드 ${target}장 소환` }),
  drawDays: (target: number): WeeklyMissionCondition => ({ kind: 'active_days', event_type: 'card.acquired', target, label: `서로 다른 ${target}일에 카드 소환` }),
  fuse: (target: number): WeeklyMissionCondition => ({ kind: 'event_count', event_type: 'card.fused', target, label: `한계돌파 ${target}회 성공` }),
  fuseVariety: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_metadata', event_type: 'card.fused', metadata_key: 'channel_id', target, label: `서로 다른 스트리머 ${target}명의 카드 한계돌파` }),
  sell: (target: number): WeeklyMissionCondition => ({ kind: 'event_value', event_type: 'card.sold', target, label: `보관함 카드 ${target}장 판매` }),
  trade: (target: number): WeeklyMissionCondition => ({ kind: 'event_count', event_type: 'trade.completed', target, label: `카드 교환 ${target}회 완료` }),
  tradePartners: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_metadata', event_type: 'trade.completed', metadata_key: 'counterparty_user_id', target, label: `서로 다른 이용자 ${target}명과 교환` }),
  marketBuy: (target: number): WeeklyMissionCondition => ({ kind: 'event_count', event_type: 'market.purchase', target, label: `마켓 카드 ${target}회 구매·낙찰` }),
  marketBuyPartners: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_metadata', event_type: 'market.purchase', metadata_key: 'seller_id', target, label: `서로 다른 판매자 ${target}명에게 구매·낙찰` }),
  marketSell: (target: number): WeeklyMissionCondition => ({ kind: 'event_count', event_type: 'market.sale', target, label: `마켓 카드 ${target}회 판매 완료` }),
  marketSellPartners: (target: number): WeeklyMissionCondition => ({ kind: 'distinct_metadata', event_type: 'market.sale', metadata_key: 'buyer_id', target, label: `서로 다른 구매자 ${target}명에게 판매 완료` })
};

const singleFamilyDefinitions: Array<{
  family: string;
  label: string;
  variants: Record<WeeklyMissionDifficulty, Array<{ title: string; description: string; conditions: WeeklyMissionCondition[] }>>;
}> = [
  { family: 'attendance', label: '출석', variants: {
    easy: [
      { title: '이번 주 첫걸음', description: '이번 주에 1일 출석하세요.', conditions: [condition.attendance(1)] },
      { title: '반가운 얼굴', description: '서로 다른 날에 2일 출석하세요.', conditions: [condition.attendance(2)] }
    ],
    normal: [
      { title: '꾸준한 방문', description: '서로 다른 날에 3일 출석하세요.', conditions: [condition.attendance(3)] },
      { title: '주간 단골', description: '서로 다른 날에 4일 출석하세요.', conditions: [condition.attendance(4)] }
    ],
    hard: [
      { title: '성실한 한 주', description: '서로 다른 날에 5일 출석하세요.', conditions: [condition.attendance(5)] },
      { title: '개근에 도전', description: '서로 다른 날에 6일 출석하세요.', conditions: [condition.attendance(6)] }
    ]
  }},
  { family: 'minigame', label: '미니게임', variants: {
    easy: [
      { title: '가볍게 몸풀기', description: '오늘의 미니게임을 2회 성공하세요.', conditions: [condition.minigame(2)] },
      { title: '세 번의 정답', description: '오늘의 미니게임을 3회 성공하세요.', conditions: [condition.minigame(3)] }
    ],
    normal: [
      { title: '미니게임 주자', description: '오늘의 미니게임을 8회 성공하세요.', conditions: [condition.minigame(8)] },
      { title: '종목 순회', description: '이번 주에 등장하는 서로 다른 미니게임 3종을 성공하세요.', conditions: [condition.minigameVariety(3)] }
    ],
    hard: [
      { title: '미니게임 마스터', description: '오늘의 미니게임을 18회 성공하세요.', conditions: [condition.minigame(18)] },
      { title: '다재다능', description: '이번 주에 등장하는 서로 다른 미니게임 4종을 성공하세요.', conditions: [condition.minigameVariety(4)] }
    ]
  }},
  { family: 'draw', label: '소환', variants: {
    easy: [
      { title: '새 카드 두 장', description: '카드를 2장 소환하세요.', conditions: [condition.draw(2)] },
      { title: '작은 카드팩', description: '카드를 3장 소환하세요.', conditions: [condition.draw(3)] }
    ],
    normal: [
      { title: '카드 수집 주간', description: '카드를 8장 소환하세요.', conditions: [condition.draw(8)] },
      { title: '열 장의 만남', description: '카드를 10장 소환하세요.', conditions: [condition.draw(10)] }
    ],
    hard: [
      { title: '대규모 소환', description: '카드를 20장 소환하세요.', conditions: [condition.draw(20)] },
      { title: '수집가의 집념', description: '카드를 30장 소환하세요.', conditions: [condition.draw(30)] }
    ]
  }},
  { family: 'fusion', label: '한계돌파', variants: {
    easy: [
      { title: '첫 한계돌파', description: '한계돌파를 1회 성공하세요.', conditions: [condition.fuse(1)] },
      { title: '두 번 더 강하게', description: '한계돌파를 2회 성공하세요.', conditions: [condition.fuse(2)] }
    ],
    normal: [
      { title: '성장 가속', description: '한계돌파를 3회 성공하세요.', conditions: [condition.fuse(3)] },
      { title: '고른 성장', description: '서로 다른 스트리머 3명의 카드를 한계돌파하세요.', conditions: [condition.fuseVariety(3)] }
    ],
    hard: [
      { title: '한계를 넘어서', description: '한계돌파를 8회 성공하세요.', conditions: [condition.fuse(8)] },
      { title: '컬렉션 강화', description: '서로 다른 스트리머 6명의 카드를 한계돌파하세요.', conditions: [condition.fuseVariety(6)] }
    ]
  }},
  { family: 'inventory_sale', label: '보관함 판매', variants: {
    easy: [
      { title: '보관함 정리', description: '보관함에서 카드 3장을 판매하세요.', conditions: [condition.sell(3)] },
      { title: '가벼운 정돈', description: '보관함에서 카드 5장을 판매하세요.', conditions: [condition.sell(5)] }
    ],
    normal: [
      { title: '본격 정리', description: '보관함에서 카드 12장을 판매하세요.', conditions: [condition.sell(12)] },
      { title: '깔끔한 보관함', description: '보관함에서 카드 15장을 판매하세요.', conditions: [condition.sell(15)] }
    ],
    hard: [
      { title: '대청소', description: '보관함에서 카드 30장을 판매하세요.', conditions: [condition.sell(30)] },
      { title: '정리의 달인', description: '보관함에서 카드 40장을 판매하세요.', conditions: [condition.sell(40)] }
    ]
  }},
  { family: 'trade', label: '교환', variants: {
    easy: [
      { title: '첫 교환', description: '카드 교환을 1회 완료하세요.', conditions: [condition.trade(1)] },
      { title: '교환의 시작', description: '카드 교환을 2회 완료하세요.', conditions: [condition.trade(2)] }
    ],
    normal: [
      { title: '교환 파트너', description: '카드 교환을 3회 완료하세요.', conditions: [condition.trade(3)] },
      { title: '새로운 인연', description: '서로 다른 이용자 3명과 카드 교환을 완료하세요.', conditions: [condition.tradePartners(3)] }
    ],
    hard: [
      { title: '교환 전문가', description: '카드 교환을 6회 완료하세요.', conditions: [condition.trade(6)] },
      { title: '교환 네트워크', description: '서로 다른 이용자 5명과 카드 교환을 완료하세요.', conditions: [condition.tradePartners(5)] }
    ]
  }},
  { family: 'market_buy', label: '마켓 구매', variants: {
    easy: [
      { title: '마켓 첫 구매', description: '마켓에서 카드를 1회 구매하세요.', conditions: [condition.marketBuy(1)] },
      { title: '알뜰 쇼핑', description: '마켓에서 카드를 2회 구매하세요.', conditions: [condition.marketBuy(2)] }
    ],
    normal: [
      { title: '마켓 탐색가', description: '마켓에서 카드를 3회 구매하세요.', conditions: [condition.marketBuy(3)] },
      { title: '여러 판매자와 거래', description: '서로 다른 판매자 3명에게 마켓 카드를 구매하거나 낙찰받으세요.', conditions: [condition.marketBuyPartners(3)] }
    ],
    hard: [
      { title: '마켓 수집가', description: '마켓에서 카드를 6회 구매하세요.', conditions: [condition.marketBuy(6)] },
      { title: '마켓 단골', description: '서로 다른 판매자 5명에게 마켓 카드를 구매하거나 낙찰받으세요.', conditions: [condition.marketBuyPartners(5)] }
    ]
  }},
  { family: 'market_sell', label: '마켓 판매', variants: {
    easy: [
      { title: '마켓 첫 판매', description: '마켓에서 마켓 카드를 1회 판매하세요.', conditions: [condition.marketSell(1)] },
      { title: '두 번의 판매', description: '마켓에서 마켓 카드를 2회 판매하세요.', conditions: [condition.marketSell(2)] }
    ],
    normal: [
      { title: '마켓 판매자', description: '마켓에서 마켓 카드를 3회 판매하세요.', conditions: [condition.marketSell(3)] },
      { title: '여러 구매자 만나기', description: '서로 다른 구매자 3명에게 마켓 카드 판매를 완료하세요.', conditions: [condition.marketSellPartners(3)] }
    ],
    hard: [
      { title: '마켓 상인', description: '마켓에서 마켓 카드를 6회 판매하세요.', conditions: [condition.marketSell(6)] },
      { title: '단골을 만드는 상인', description: '서로 다른 구매자 5명에게 마켓 카드 판매를 완료하세요.', conditions: [condition.marketSellPartners(5)] }
    ]
  }}
];

const singles: WeeklyMissionTemplate[] = singleFamilyDefinitions.flatMap(({ family, variants }) =>
  (Object.keys(variants) as WeeklyMissionDifficulty[]).flatMap((difficulty) =>
    variants[difficulty].map((variant, index) => ({
      code: `${family}_${difficulty}_${index + 1}`,
      difficulty,
      families: [family],
      ...variant
    }))
  )
);

const compound: WeeklyMissionTemplate[] = [
  { code: 'compound_easy_1', difficulty: 'easy', families: ['attendance', 'minigame'], title: '출석하고 한 판', description: '이번 주에 방문하고 미니게임도 즐겨 보세요.', conditions: [condition.attendance(1), condition.minigame(2)] },
  { code: 'compound_easy_2', difficulty: 'easy', families: ['draw', 'inventory_sale'], title: '뽑고 정리하기', description: '카드를 소환하고 보관함도 정리하세요.', conditions: [condition.draw(3), condition.sell(3)] },
  { code: 'compound_easy_3', difficulty: 'easy', families: ['draw', 'fusion'], title: '소환과 성장', description: '새 카드를 만나고 한계돌파도 성공하세요.', conditions: [condition.draw(3), condition.fuse(1)] },
  { code: 'compound_easy_4', difficulty: 'easy', families: ['market_buy', 'market_sell'], title: '마켓 왕복', description: '마켓 카드를 사고팔아 보세요.', conditions: [condition.marketBuy(1), condition.marketSell(1)] },
  { code: 'compound_normal_1', difficulty: 'normal', families: ['attendance', 'minigame'], title: '꾸준한 도전자', description: '여러 날 방문하며 미니게임에 도전하세요.', conditions: [condition.attendance(3), condition.minigame(6)] },
  { code: 'compound_normal_2', difficulty: 'normal', families: ['draw', 'fusion'], title: '수집과 강화', description: '카드를 모으고 한계돌파로 성장시키세요.', conditions: [condition.draw(8), condition.fuse(3)] },
  { code: 'compound_normal_3', difficulty: 'normal', families: ['trade', 'market_buy'], title: '두 가지 거래', description: '교환과 마켓 구매를 모두 완료하세요.', conditions: [condition.trade(2), condition.marketBuy(2)] },
  { code: 'compound_normal_4', difficulty: 'normal', families: ['inventory_sale', 'market_sell'], title: '판매 루틴', description: '보관함 판매와 마켓 판매를 모두 진행하세요.', conditions: [condition.sell(10), condition.marketSell(2)] },
  { code: 'compound_hard_1', difficulty: 'hard', families: ['attendance', 'minigame'], title: '한 주의 도전자', description: '꾸준히 방문하며 미니게임 실력을 증명하세요.', conditions: [condition.attendance(4), condition.minigame(15)] },
  { code: 'compound_hard_2', difficulty: 'hard', families: ['draw', 'fusion'], title: '수집가의 성장 주간', description: '대량 소환과 한계돌파를 모두 달성하세요.', conditions: [condition.draw(20), condition.fuse(8)] },
  { code: 'compound_hard_3', difficulty: 'hard', families: ['trade', 'market_buy'], title: '거래의 달인', description: '교환과 마켓 마켓 구매를 활발히 이용하세요.', conditions: [condition.trade(5), condition.marketBuy(5)] },
  { code: 'compound_hard_4', difficulty: 'hard', families: ['inventory_sale', 'market_sell'], title: '판매의 달인', description: '보관함과 마켓에서 모두 판매 성과를 내세요.', conditions: [condition.sell(30), condition.marketSell(5)] }
];

const weeklyRoutines: WeeklyMissionTemplate[] = [
  { code: 'routine_easy_1', difficulty: 'easy', families: ['minigame'], title: '다시 찾은 게임방', description: '서로 다른 2일에 미니게임을 성공하세요.', conditions: [condition.minigameDays(2)] },
  { code: 'routine_easy_2', difficulty: 'easy', families: ['draw'], title: '매일 새로운 만남', description: '서로 다른 2일에 카드를 소환하세요.', conditions: [condition.drawDays(2)] },
  { code: 'routine_easy_3', difficulty: 'easy', families: ['minigame', 'inventory_sale'], title: '게임 뒤 가벼운 정리', description: '미니게임도 성공하고 보관함도 정리하세요.', conditions: [condition.minigame(2), condition.sell(2)] },
  { code: 'routine_easy_4', difficulty: 'easy', families: ['draw', 'trade'], title: '만나고 나누기', description: '새 카드를 소환하고 교환을 완료하세요.', conditions: [condition.draw(2), condition.trade(1)] },
  { code: 'routine_normal_1', difficulty: 'normal', families: ['minigame'], title: '게임방 단골', description: '서로 다른 3일에 미니게임을 성공하고, 총 6회 성공하세요.', conditions: [condition.minigameDays(3), condition.minigame(6)] },
  { code: 'routine_normal_2', difficulty: 'normal', families: ['draw'], title: '차곡차곡 수집', description: '서로 다른 3일에 소환하며 카드 6장을 모으세요.', conditions: [condition.drawDays(3), condition.draw(6)] },
  { code: 'routine_normal_3', difficulty: 'normal', families: ['fusion', 'minigame'], title: '실력과 카드의 성장', description: '미니게임과 한계돌파를 모두 성공하세요.', conditions: [condition.minigame(5), condition.fuse(2)] },
  { code: 'routine_normal_4', difficulty: 'normal', families: ['attendance', 'trade'], title: '들러서 교환하기', description: '서로 다른 날에 출석하고 교환도 완료하세요.', conditions: [condition.attendance(3), condition.trade(2)] },
  { code: 'routine_hard_1', difficulty: 'hard', families: ['minigame'], title: '꾸준한 게임 실력', description: '서로 다른 4일에 미니게임을 성공하고, 총 12회 성공하세요.', conditions: [condition.minigameDays(4), condition.minigame(12)] },
  { code: 'routine_hard_2', difficulty: 'hard', families: ['draw', 'fusion'], title: '폭넓은 컬렉션 성장', description: '카드 15장을 소환하고 서로 다른 스트리머 4명의 카드를 한계돌파하세요.', conditions: [condition.draw(15), condition.fuseVariety(4)] },
  { code: 'routine_hard_3', difficulty: 'hard', families: ['draw', 'trade'], title: '함께 넓히는 컬렉션', description: '카드 15장을 소환하고 서로 다른 이용자 3명과 교환하세요.', conditions: [condition.draw(15), condition.tradePartners(3)] },
  { code: 'routine_hard_4', difficulty: 'hard', families: ['attendance', 'minigame', 'draw'], title: '치카포를 즐기는 한 주', description: '출석·미니게임·소환을 모두 즐겨 보세요.', conditions: [condition.attendance(3), condition.minigame(10), condition.draw(10)] }
];

export const WEEKLY_MISSION_CATALOG: WeeklyMissionTemplate[] = [...singles, ...compound, ...weeklyRoutines];

const DAILY_MINIGAMES = ['quiz', 'match', 'fan_meeting', 'streamer_catch', 'sequence_relay'] as const;

export const scheduledMinigameForKstDate = (kstDate: string): string => {
  const digest = crypto.createHash('sha256').update(`chikapo-daily-minigame:${kstDate}`).digest();
  return DAILY_MINIGAMES[digest.readUInt32BE(0) % DAILY_MINIGAMES.length];
};

export const weeklyMissionReward = (difficulty: WeeklyMissionDifficulty) => ({
  points: difficulty === 'easy' ? 900 : difficulty === 'normal' ? 1500 : 3200,
  minigame_tickets: difficulty === 'normal' ? 1 : 0,
  free_draw_tickets: difficulty === 'hard' ? 1 : 0
});
