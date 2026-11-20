import type { Achievement, AchievementCategory, AchievementReward, AchievementTier } from './achievementService';

type Goal = Pick<Achievement, 'progress_mode' | 'criteria_json'>;
type Entry = {
  code: string;
  name: string;
  description: string;
  tier: AchievementTier;
  goal: Goal;
  rewards: AchievementReward[];
  hint?: string;
};

const snapshot = (metric: string, target: number): Goal => ({
  progress_mode: 'snapshot', criteria_json: { type: 'stat', metric, target }
});
const counter = (metric: string, target: number): Goal => ({
  progress_mode: 'incremental', criteria_json: { type: 'stat', metric, target }
});
const together = (targets: Record<string, number>): Goal => ({
  progress_mode: 'composite',
  criteria_json: {
    type: 'all',
    conditions: Object.entries(targets).map(([metric, target]) => ({ type: 'stat', metric, target }))
  }
});
const points = (amount: number): AchievementReward => ({ type: 'point', points: amount });
const playTickets = (quantity: number): AchievementReward => ({ type: 'minigame_ticket', quantity });
const drawTickets = (quantity: number): AchievementReward => ({ type: 'free_draw_ticket', quantity });
const drawTicket = drawTickets(1);

const groups: { category: AchievementCategory; icon: string; color: string; entries: Entry[] }[] = [
  { category: 'start', icon: 'Contact', color: '#0891b2', entries: [
    { code: 'profile_calling_card', name: '카드 한 장, 소개 한 줄', tier: 'bronze',
      description: '대표 카드와 상태 메시지로 내 프로필을 완성하세요.',
      goal: together({ 'profile.representative.set': 1, 'profile.status_message.set': 1 }), rewards: [points(500)] },
    { code: 'first_binder_sort', name: '첫 보관함 정리', tier: 'bronze',
      description: '소환으로 카드를 모은 뒤 보관함에서 한 장을 판매하세요.',
      goal: together({ 'card.acquired.count': 3, 'card.sold.count': 1 }), rewards: [points(750)] }
  ] },
  { category: 'attendance', icon: 'CalendarCheck', color: '#0d9488', entries: [
    { code: 'three_attendance_stamps', name: '세 번째 출석 도장', tier: 'bronze',
      description: '서로 다른 날에 세 번 출석하세요. 연속일 필요는 없습니다.',
      goal: counter('login.daily.count', 3), rewards: [playTickets(1)] },
    { code: 'fortnight_favorites', name: '보름 동안 고른 최애', tier: 'silver',
      description: '누적 출석 15일을 채우고 가장 좋아하는 카드 세 장을 즐겨찾기에 두세요.',
      goal: together({ 'login.daily.count': 15, 'inventory.favorite_count': 3 }), rewards: [points(1500)] },
    { code: 'fortnight_album', name: '작심삼일 탈출', tier: 'gold',
      description: '연속 출석 14일 기록을 세우고 스트리머 카드 30종을 모으세요.',
      goal: together({ 'login.max_streak_days': 14, 'inventory.unique_streamer_count': 30 }), rewards: [drawTicket] }
  ] },
  { category: 'collection', icon: 'BookOpen', color: '#16a34a', entries: [
    { code: 'album_keepsakes', name: '금이야 옥이야', tier: 'bronze',
      description: '간직할 카드 다섯 장을 잠그고 즐겨찾기에 세 장을 올리세요.',
      goal: together({ 'inventory.locked_count': 5, 'inventory.favorite_count': 3 }), rewards: [points(700)] },
    { code: 'album_early_print', name: '열 손가락 안에 든 카드', tier: 'silver',
      description: '시리얼 번호가 10번 이하인 카드를 보관하세요.',
      goal: snapshot('inventory.low_serial.10.count', 1), rewards: [points(1200)] },
    { code: 'album_print_run', name: '초판 수집 노트', tier: 'gold',
      description: '시리얼 번호가 100번 이하인 카드 열 장으로 컬렉션을 만드세요.',
      goal: snapshot('inventory.low_serial.100.count', 10), rewards: [points(2500)] },
    { code: 'album_star_palette', name: '각양각색', tier: 'silver',
      description: '별 등급이 서로 다른 카드 네 장을 한 보관함에 모으세요.',
      goal: snapshot('inventory.unique_star_level_count', 4), rewards: [points(1500)] },
    { code: 'album_first_print', name: '세상에 한 장뿐인 1번', tier: 'platinum',
      description: '어느 스트리머든 시리얼 1번 카드를 소장하세요.',
      goal: snapshot('inventory.low_serial.1.count', 1), rewards: [drawTicket] },
    { code: 'album_deep_shelves', name: '티끌 모아 태산', tier: 'platinum',
      description: '스트리머 100종을 포함해 카드 천 장을 보관하세요.',
      goal: together({ 'inventory.card_count': 1000, 'inventory.unique_streamer_count': 100 }), rewards: [drawTicket, points(2500)] },
    { code: 'album_grand_archive', name: '치카포 카드 박물관', tier: 'legendary',
      description: '스트리머 200종이 담긴 2,500장 규모의 보관함을 완성하세요.',
      goal: together({ 'inventory.card_count': 2500, 'inventory.unique_streamer_count': 200 }), rewards: [drawTicket, points(5000)] }
  ] },
  { category: 'growth', icon: 'Star', color: '#d97706', entries: [
    { code: 'growth_workbench', name: '다섯 번째 한계돌파', tier: 'bronze',
      description: '보관함에서 카드 한계돌파를 다섯 번 성공시키세요.',
      goal: counter('card.fused.count', 5), rewards: [points(1200)] },
    { code: 'growth_twin_triples', name: '나란히 빛나는 3성', tier: 'silver',
      description: '3성 카드 두 장을 동시에 보관하세요.',
      goal: snapshot('inventory.star.3.count', 2), rewards: [points(1800)] },
    { code: 'growth_constellation', name: '별 헤는 밤', tier: 'gold',
      description: '보유한 모든 카드의 별을 합쳐 마흔 개를 모으세요.',
      goal: snapshot('inventory.total_star_sum', 40), rewards: [points(2500)] },
    { code: 'growth_front_row', name: '별들의 잔치', tier: 'platinum',
      description: '4성 카드 두 장과 5성 카드 한 장을 함께 보관하세요.',
      goal: together({ 'inventory.star.4.count': 2, 'inventory.star.5.count': 1 }), rewards: [drawTicket] },
    { code: 'growth_master_bench', name: '장인의 손길', tier: 'legendary',
      description: '한계돌파 60회를 성공시키고 5성 카드 두 장을 보유하세요.',
      goal: together({ 'card.fused.count': 60, 'inventory.star.5.count': 2 }), rewards: [drawTicket, points(3000)] }
  ] },
  { category: 'economy', icon: 'Palette', color: '#db2777', entries: [
    { code: 'economy_clear_a_shelf', name: '보관함 대청소', tier: 'bronze',
      description: '보관함 판매로 카드 스무 장을 정리하세요.',
      goal: counter('card.sold.count', 20), rewards: [points(800)] },
    { code: 'economy_two_finishes', name: '이왕이면 세트로', tier: 'silver',
      description: '장착하지 않은 테두리와 이름 이펙트를 한 개씩 보유하세요.',
      goal: together({ 'user.border_cosmetic_count': 1, 'user.name_effect_cosmetic_count': 1 }), rewards: [points(1400)] },
    { code: 'economy_wardrobe', name: '골라 입는 재미', tier: 'gold',
      description: '장착하지 않은 코스메틱을 다섯 종류 모으세요.',
      goal: snapshot('user.unique_cosmetic_count', 5), rewards: [points(2400)] },
    { code: 'economy_shop_regular', name: '꿩 먹고 알 먹고', tier: 'gold',
      description: '보관함에서 카드 100장을 판매하고 꾸미기 상점에서 다섯 번 구매하세요.',
      goal: together({ 'card.sold.count': 100, 'shop.purchase.count': 5 }), rewards: [points(2600)] },
    { code: 'economy_display_case', name: '옷이 날개', tier: 'platinum',
      description: '보유 카드에 테두리 세 개와 이름 이펙트 두 개를 장착하세요.',
      goal: together({ 'inventory.border_equipped_count': 3, 'inventory.name_effect_equipped_count': 2 }), rewards: [drawTicket] }
  ] },
  { category: 'trade', icon: 'Handshake', color: '#0284c7', entries: [
    { code: 'trade_first_handshake', name: '첫 악수', tier: 'bronze',
      description: '다른 수집가와 첫 1:1 교환을 성사시키세요.',
      goal: counter('trade.completed.count', 1), rewards: [points(700)] },
    { code: 'trade_regular_guest', name: '교환대 단골', tier: 'silver',
      description: '1:1 교환을 열 번 성사시키세요.',
      goal: counter('trade.completed.count', 10), rewards: [points(1500)] },
    { code: 'trade_album_swap', name: '누이 좋고 매부 좋고', tier: 'silver',
      description: '교환 다섯 번을 성사시키고 스트리머 카드 20종을 보유하세요.',
      goal: together({ 'trade.completed.count': 5, 'inventory.unique_streamer_count': 20 }), rewards: [playTickets(1)] },
    { code: 'trade_neighbors', name: '발이 넓은 수집가', tier: 'gold',
      description: '친구 다섯 명을 사귀고 누적 교환 12회를 달성하세요.',
      goal: together({ 'community.friend_count': 5, 'trade.completed.count': 12 }), rewards: [points(2300)] },
    { code: 'trade_exchange_desk', name: '교환대에서 장터까지', tier: 'platinum',
      description: '1:1 교환 50회와 오픈마켓 판매 완료 다섯 건을 기록하세요.',
      goal: together({ 'trade.completed.count': 50, 'market.sold_listing_count': 5 }), rewards: [drawTicket] }
  ] },
  { category: 'market', icon: 'Store', color: '#0f766e', entries: [
    { code: 'market_first_receipt', name: '마수걸이', tier: 'bronze',
      description: '오픈마켓에 올린 카드의 판매를 처음으로 완료하세요.',
      goal: snapshot('market.sold_listing_count', 1), rewards: [points(800)] },
    { code: 'market_wish_list', name: '눈독 들인 카드', tier: 'silver',
      description: '마켓 관심 알림 두 개를 설정하고 구매 한 건을 완료하세요.',
      goal: together({ 'market.watch_count': 2, 'market.bought_listing_count': 1 }), rewards: [points(1300)] },
    { code: 'market_both_sides', name: '주거니 받거니', tier: 'silver',
      description: '오픈마켓에서 구매와 판매를 각각 세 건 완료하세요.',
      goal: together({ 'market.bought_listing_count': 3, 'market.sold_listing_count': 3 }), rewards: [points(1800)] },
    { code: 'market_two_price_tags', name: '두 가지 가격표', tier: 'silver',
      description: '고정가 판매와 경매를 한 건씩 동시에 열어 두세요.',
      goal: together({ 'market.active_fixed_listing_count': 1, 'market.active_auction_listing_count': 1 }), rewards: [points(900)] },
    { code: 'market_bidding_card', name: '경매는 눈치 싸움', tier: 'gold',
      description: '경매에 세 번 입찰하고 오픈마켓에서 카드 구매 다섯 건을 완료하세요.',
      goal: together({ 'market.bid.count': 3, 'market.bought_listing_count': 5 }), rewards: [points(2000)] },
    { code: 'market_long_ledger', name: '장터 터줏대감', tier: 'platinum',
      description: '마켓 판매 25건과 구매 10건이 담긴 거래 장부를 만드세요.',
      goal: together({ 'market.sold_listing_count': 25, 'market.bought_listing_count': 10 }), rewards: [drawTicket, points(1500)] }
  ] },
  { category: 'minigame', icon: 'Gamepad2', color: '#7c3aed', entries: [
    { code: 'arcade_quiz_eye', name: '흐릿해도 알아요', tier: 'silver',
      description: '정식 스트리머 퀴즈에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.quiz.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_matching_pairs', name: '찰떡궁합', tier: 'silver',
      description: '정식 그림 짝맞추기에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.match.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_fan_queue', name: '줄은 이쪽입니다', tier: 'silver',
      description: '정식 팬 줄서기에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.fan_meeting.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_guest_spotter', name: '매의 눈', tier: 'silver',
      description: '정식 게스트 캐치에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.streamer_catch.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_sequence_encore', name: '눈 감고도 한다', tier: 'silver',
      description: '정식 순서 기억에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.sequence_relay.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_faces_and_pairs', name: '척하면 척', tier: 'gold',
      description: '정식 스트리머 퀴즈와 그림 짝맞추기에서 각각 열 번 성공하세요.',
      goal: together({ 'minigame.success.quiz.count': 10, 'minigame.success.match.count': 10 }), rewards: [playTickets(2)] },
    { code: 'arcade_five_stations', name: '오락실 도장깨기', tier: 'platinum',
      description: '정식 미니게임 다섯 종에서 각각 세 번씩 성공하세요.',
      goal: together({ 'minigame.success.quiz.count': 3, 'minigame.success.match.count': 3,
        'minigame.success.fan_meeting.count': 3, 'minigame.success.streamer_catch.count': 3,
        'minigame.success.sequence_relay.count': 3 }), rewards: [drawTicket, playTickets(1)] }
  ] },
  { category: 'community', icon: 'Users', color: '#2563eb', entries: [
    { code: 'community_first_friend', name: '첫 번째 친구', tier: 'bronze',
      description: '서로 친구가 된 수집가를 한 명 만드세요.',
      goal: snapshot('community.friend_count', 1), rewards: [points(500)] },
    { code: 'community_greeting', name: '안부 한 줄', tier: 'silver',
      description: '친구 세 명을 사귀고 프로필에 상태 메시지를 남기세요.',
      goal: together({ 'community.friend_count': 3, 'profile.status_message.set': 1 }), rewards: [points(1200)] },
    { code: 'community_album_club', name: '카드첩 동호회', tier: 'gold',
      description: '친구 열 명과 스트리머 카드 25종이 있는 수집가가 되세요.',
      goal: together({ 'community.friend_count': 10, 'inventory.unique_streamer_count': 25 }), rewards: [points(2400)] }
  ] },
  { category: 'event', icon: 'Stamp', color: '#be185d', entries: [
    { code: 'mission_first_stamp', name: '주간 미션 첫 도장', tier: 'bronze',
      description: '아무 주간 미션이든 보상을 한 번 수령하세요.',
      goal: snapshot('weekly_mission.claimed_count', 1), rewards: [points(500)] },
    { code: 'mission_full_week', name: '이번 주 숙제 끝!', tier: 'gold',
      description: '같은 주에 배정된 다섯 미션의 보상을 전부 수령하세요.',
      goal: snapshot('weekly_mission.full_week_count', 1), rewards: [playTickets(2)] },
    { code: 'mission_four_full_weeks', name: '빈칸 없는 네 주', tier: 'legendary',
      description: '다섯 보상을 모두 받은 주를 네 번 기록하세요. 연속일 필요는 없습니다.',
      goal: snapshot('weekly_mission.full_week_count', 4), rewards: [drawTicket, points(3000)] },
    { code: 'coupon_scrapbook', name: '쿠폰 스크랩북', tier: 'silver',
      description: '서로 다른 쿠폰 세 개를 사용하세요.',
      goal: snapshot('coupon.redeemed_unique_count', 3), rewards: [points(1200)] }
  ] },
  { category: 'hidden', icon: 'Sparkles', color: '#9333ea', entries: [
    { code: 'secret_first_edition_gallery', name: '초판 전시회', tier: 'gold',
      description: '시리얼 1번 카드를 소장하고 테두리 세 개를 보유 카드에 장착하세요.',
      hint: '시리얼 번호와 진열장의 테두리를 살펴보세요.',
      goal: together({ 'inventory.low_serial.1.count': 1, 'inventory.border_equipped_count': 3 }), rewards: [points(3000)] },
    { code: 'secret_starlit_stairs', name: '별별 게 다 있네', tier: 'platinum',
      description: '0성부터 5성까지 모든 등급의 카드를 한꺼번에 보관하세요.',
      hint: '별이 하나도 없는 카드도 도감의 한 칸입니다.',
      goal: snapshot('inventory.unique_star_level_count', 6), rewards: [drawTicket] },
    { code: 'secret_festival_staff', name: '팔방미인', tier: 'gold',
      description: '팬 줄서기, 게스트 캐치, 순서 기억에서 각각 열 번 성공하세요.',
      hint: '팬과 게스트를 맞이하고 출연 순서까지 기억해 보세요.',
      goal: together({ 'minigame.success.fan_meeting.count': 10, 'minigame.success.streamer_catch.count': 10,
        'minigame.success.sequence_relay.count': 10 }), rewards: [playTickets(2), points(1500)] },
    { code: 'secret_trade_triangle', name: '거래의 고수', tier: 'gold',
      description: '1:1 교환과 오픈마켓 구매·판매를 각각 다섯 번 완료하세요.',
      hint: '카드가 오가는 방법은 한 가지가 아닙니다.',
      goal: together({ 'trade.completed.count': 5, 'market.bought_listing_count': 5, 'market.sold_listing_count': 5 }), rewards: [points(2700)] },
    { code: 'secret_mission_souvenir', name: '두 마리 토끼', tier: 'platinum',
      description: '한 주의 미션 보상을 모두 받은 기록과 즐겨찾기 열 장을 모으세요.',
      hint: '주간 도장을 완성하고 즐겨찾기 진열장도 채워 보세요.',
      goal: together({ 'weekly_mission.full_week_count': 1, 'inventory.favorite_count': 10 }), rewards: [drawTicket] }
  ] }
];

const legendaryByCategory: Partial<Record<AchievementCategory, Omit<Entry, 'tier'>[]>> = {
  attendance: [
    { code: 'legend_rain_or_shine', name: '비가 오나 눈이 오나',
      description: '하루도 빠짐없이 400일 연속 출석하세요.',
      goal: snapshot('login.max_streak_days', 400), rewards: [drawTickets(4), points(15000)] },
    { code: 'legend_two_years', name: '어느덧 2년',
      description: '출석한 날이 모두 730일이면 달성합니다. 중간에 쉬어도 괜찮아요.',
      goal: counter('login.daily.count', 730), rewards: [drawTickets(5), points(20000)] }
  ],
  collection: [
    { code: 'legend_card_library', name: '없는 게 없는 카드첩',
      description: '스트리머 2,000종을 포함해 카드 10,000장을 한 보관함에 모으세요.',
      goal: together({ 'inventory.card_count': 10000, 'inventory.unique_streamer_count': 2000 }), rewards: [drawTickets(5), points(20000)] },
    { code: 'legend_first_editions', name: '초판본 컬렉터',
      description: '시리얼 10번 이하 카드 250장을 소장하세요. 그중 25장은 시리얼 1번이어야 합니다.',
      goal: together({ 'inventory.low_serial.10.count': 250, 'inventory.low_serial.1.count': 25 }), rewards: [drawTickets(3), points(10000)] },
    { code: 'legend_every_star', name: '한 등급도 빠짐없이',
      description: '0성부터 5성까지, 여섯 등급의 카드를 각각 50장씩 동시에 보관하세요.',
      goal: together({ 'inventory.star.0.count': 50, 'inventory.star.1.count': 50, 'inventory.star.2.count': 50,
        'inventory.star.3.count': 50, 'inventory.star.4.count': 50, 'inventory.star.5.count': 50 }), rewards: [drawTickets(3), points(12000)] }
  ],
  growth: [
    { code: 'legend_thousand_fusions', name: '천 번의 담금질',
      description: '한계돌파를 1,000번 성공시키고 5성 카드 25장을 소장하세요.',
      goal: together({ 'card.fused.count': 1000, 'inventory.star.5.count': 25 }), rewards: [drawTickets(3), points(12000)] },
    { code: 'legend_starry_sky', name: '별이 쏟아진다',
      description: '보관함의 별을 모두 더해 3,000개를 채우고, 5성 카드만 100장을 모으세요.',
      goal: together({ 'inventory.total_star_sum': 3000, 'inventory.star.5.count': 100 }), rewards: [drawTickets(4), points(15000)] }
  ],
  economy: [
    { code: 'legend_runway', name: '오늘은 패션쇼',
      description: '보유 카드에 테두리 25개와 이름 이펙트 25개를 동시에 장착하세요.',
      goal: together({ 'inventory.border_equipped_count': 25, 'inventory.name_effect_equipped_count': 25 }), rewards: [drawTickets(2), points(10000)] },
    { code: 'legend_nest_egg', name: '소문난 알부자',
      description: '포인트 잔액 500만 P와 총자산 2,500만 P를 동시에 달성하세요.',
      goal: together({ 'user.point_balance': 5000000, 'user.total_asset': 25000000 }), rewards: [drawTickets(4), points(15000)] },
    { code: 'legend_shop_turnover', name: '비우고 또 채우고',
      description: '보관함에서 카드 3,000장을 판매하고 꾸미기 상점에서 40번 구매하세요.',
      goal: together({ 'card.sold.count': 3000, 'shop.purchase.count': 40 }), rewards: [drawTickets(2), points(12000)] }
  ],
  trade: [
    { code: 'legend_thousand_handshakes', name: '천 번의 악수',
      description: '다른 수집가와 1:1 교환을 1,000번 성사시키세요.',
      goal: counter('trade.completed.count', 1000), rewards: [drawTickets(3), points(15000)] },
    { code: 'legend_trade_circle', name: '전국구 마당발',
      description: '친구 30명을 사귀고 1:1 교환 300회와 오픈마켓 판매 75건을 달성하세요.',
      goal: together({ 'community.friend_count': 30, 'trade.completed.count': 300, 'market.sale.count': 75 }), rewards: [drawTickets(2), points(12000)] }
  ],
  market: [
    { code: 'legend_market_customers', name: '천객만래',
      description: '오픈마켓에서 서로 다른 수집가 100명에게 카드를 판매하세요.',
      goal: snapshot('market.distinct_buyer_count', 100), rewards: [drawTickets(3), points(15000)] },
    { code: 'legend_market_scout', name: '발품의 달인',
      description: '오픈마켓에서 서로 다른 판매자 75명에게 카드를 사고, 스트리머 카드 500종을 보유하세요.',
      goal: together({ 'market.distinct_seller_count': 75, 'inventory.unique_streamer_count': 500 }), rewards: [drawTickets(2), points(12000)] },
    { code: 'legend_market_volume', name: '장터의 큰손',
      description: '오픈마켓에서 카드를 산 거래와 판 거래를 각각 500건 완료하세요.',
      goal: together({ 'market.purchase.count': 500, 'market.sale.count': 500 }), rewards: [drawTickets(4), points(16000)] }
  ],
  minigame: [
    { code: 'legend_arcade_champion', name: '오락실 끝판왕',
      description: '정식 스트리머 퀴즈, 그림 짝맞추기, 팬 줄서기, 게스트 캐치, 순서 기억에서 각각 250번 성공하세요.',
      goal: together({ 'minigame.success.quiz.count': 250, 'minigame.success.match.count': 250,
        'minigame.success.fan_meeting.count': 250, 'minigame.success.streamer_catch.count': 250,
        'minigame.success.sequence_relay.count': 250 }), rewards: [drawTickets(3), playTickets(10), points(15000)] },
    { code: 'legend_perfect_score', name: '백발백중',
      description: '정식 퀴즈에서 다섯 문제를 모두 맞힌 판을 100번 기록하세요. 이 업적이 추가된 뒤의 만점부터 셉니다.',
      goal: counter('minigame.perfect.count', 100), rewards: [playTickets(6), points(10000)] },
    { code: 'legend_speed_bonus', name: '눈 깜짝할 사이',
      description: '정식 미니게임의 속도 보너스 기준을 75번 달성하세요. 그림 짝맞추기는 10초입니다. 이 업적이 추가된 뒤의 기록부터 셉니다.',
      goal: counter('minigame.speed_bonus.count', 75), rewards: [playTickets(6), points(10000)] },
    { code: 'legend_arcade_marathon', name: '고인물 인증',
      description: '정식 미니게임에서 통산 5,000승을 거두세요.',
      goal: counter('minigame.success.count', 5000), rewards: [drawTickets(4), playTickets(10), points(20000)] }
  ],
  community: [
    { code: 'legend_collection_club', name: '소문난 수집가',
      description: '친구 40명을 사귀고 스트리머 카드 1,000종을 모으세요. 보유 카드에는 이름 이펙트 15개를 장착하세요.',
      goal: together({ 'community.friend_count': 40, 'inventory.unique_streamer_count': 1000, 'inventory.name_effect_equipped_count': 15 }),
      rewards: [drawTickets(3), points(12000)] }
  ],
  event: [
    { code: 'legend_mission_stamps', name: '도장판 한 권',
      description: '주간 미션 보상을 누적 150번 수령하세요. 한 주에 다섯 개를 전부 끝내지 않아도 됩니다.',
      goal: snapshot('weekly_mission.claimed_count', 150), rewards: [drawTickets(3), playTickets(5)] },
    { code: 'legend_mission_year', name: '일 년 치 숙제 끝!',
      description: '같은 주의 미션 보상 다섯 개를 모두 받은 주를 52번 채우세요. 쉬어 간 주가 있어도 됩니다.',
      goal: snapshot('weekly_mission.full_week_count', 52), rewards: [drawTickets(5), playTickets(10), points(20000)] }
  ],
  hidden: [
    { code: 'legend_private_gallery', name: '국보급 소장품',
      description: '시리얼 1번 카드 50장과 5성 카드 50장을 한 보관함에 모으세요.',
      hint: '맨 처음 나온 카드와 끝까지 키운 카드를 한자리에 모아 보세요.',
      goal: together({ 'inventory.low_serial.1.count': 50, 'inventory.star.5.count': 50 }), rewards: [drawTicket] },
    { code: 'legend_jack_of_all_trades', name: '못하는 게 뭐야?',
      description: '1:1 교환 500회, 미니게임 1,000승, 한계돌파 1,000회와 주간 미션 12주 완주를 모두 달성하세요.',
      hint: '교환대, 오락실, 한계돌파, 주간 미션에서 두루 실력을 쌓아 보세요.',
      goal: together({ 'trade.completed.count': 500, 'minigame.success.count': 1000,
        'card.fused.count': 1000, 'weekly_mission.full_week_count': 12 }), rewards: [points(8000), playTickets(2)] }
  ]
};

// Append new groups after the original catalog to preserve existing sort orders on fresh installs.
const legendaryGroups = groups.map(({ category, icon, color }) => ({
  category, icon, color, entries: (legendaryByCategory[category] ?? []).map(entry => ({ ...entry, tier: 'legendary' as const }))
}));

export const additionalAchievements = [...groups, ...legendaryGroups].flatMap(({ category, icon, color, entries }) =>
  entries.map(({ goal, rewards, hint, ...entry }) => ({
    ...entry, category, icon, icon_color: color, ...goal, rewards_json: rewards,
    is_active: true, is_hidden: Boolean(hint), hidden_hint: hint ?? null,
    starts_at: null, ends_at: null, repeat_policy: 'once' as const, claim_policy: 'manual' as const, created_by: null
  }))
).map((entry, index) => ({ ...entry, sort_order: 1100 + index * 10 }));
