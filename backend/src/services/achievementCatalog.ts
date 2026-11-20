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
const drawTicket: AchievementReward = { type: 'free_draw_ticket', quantity: 1 };

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
    { code: 'fortnight_favorites', name: '출석 도장 열다섯, 최애 셋', tier: 'silver',
      description: '누적 출석 15일을 채우고 가장 좋아하는 카드 세 장을 즐겨찾기에 두세요.',
      goal: together({ 'login.daily.count': 15, 'inventory.favorite_count': 3 }), rewards: [points(1500)] },
    { code: 'fortnight_album', name: '매일 채운 카드첩', tier: 'gold',
      description: '연속 출석 14일 기록을 세우고 스트리머 카드 30종을 모으세요.',
      goal: together({ 'login.max_streak_days': 14, 'inventory.unique_streamer_count': 30 }), rewards: [drawTicket] }
  ] },
  { category: 'collection', icon: 'BookOpen', color: '#16a34a', entries: [
    { code: 'album_keepsakes', name: '간직할 카드들', tier: 'bronze',
      description: '간직할 카드 다섯 장을 잠그고 즐겨찾기에 세 장을 올리세요.',
      goal: together({ 'inventory.locked_count': 5, 'inventory.favorite_count': 3 }), rewards: [points(700)] },
    { code: 'album_early_print', name: '앞번호의 행운', tier: 'silver',
      description: '시리얼 번호가 10번 이하인 카드를 보관하세요.',
      goal: snapshot('inventory.low_serial.10.count', 1), rewards: [points(1200)] },
    { code: 'album_print_run', name: '초판 수집 노트', tier: 'gold',
      description: '시리얼 번호가 100번 이하인 카드 열 장으로 컬렉션을 만드세요.',
      goal: snapshot('inventory.low_serial.100.count', 10), rewards: [points(2500)] },
    { code: 'album_star_palette', name: '네 칸의 별 도감', tier: 'silver',
      description: '별 등급이 서로 다른 카드 네 장을 한 보관함에 모으세요.',
      goal: snapshot('inventory.unique_star_level_count', 4), rewards: [points(1500)] },
    { code: 'album_first_print', name: '시리얼 1번은 내 거', tier: 'platinum',
      description: '어느 스트리머든 시리얼 1번 카드를 소장하세요.',
      goal: snapshot('inventory.low_serial.1.count', 1), rewards: [drawTicket] },
    { code: 'album_deep_shelves', name: '천 장이나 모았다', tier: 'platinum',
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
    { code: 'growth_constellation', name: '모아 보니 별이 마흔 개', tier: 'gold',
      description: '보유한 모든 카드의 별을 합쳐 마흔 개를 모으세요.',
      goal: snapshot('inventory.total_star_sum', 40), rewards: [points(2500)] },
    { code: 'growth_front_row', name: '4성과 5성이 한자리에', tier: 'platinum',
      description: '4성 카드 두 장과 5성 카드 한 장을 함께 보관하세요.',
      goal: together({ 'inventory.star.4.count': 2, 'inventory.star.5.count': 1 }), rewards: [drawTicket] },
    { code: 'growth_master_bench', name: '한계돌파 장인의 작업대', tier: 'legendary',
      description: '한계돌파 60회를 성공시키고 5성 카드 두 장을 보유하세요.',
      goal: together({ 'card.fused.count': 60, 'inventory.star.5.count': 2 }), rewards: [drawTicket, points(3000)] }
  ] },
  { category: 'economy', icon: 'Palette', color: '#db2777', entries: [
    { code: 'economy_clear_a_shelf', name: '빈자리가 생겼어요', tier: 'bronze',
      description: '보관함 판매로 카드 스무 장을 정리하세요.',
      goal: counter('card.sold.count', 20), rewards: [points(800)] },
    { code: 'economy_two_finishes', name: '테두리도 이름 이펙트도', tier: 'silver',
      description: '장착하지 않은 테두리와 이름 이펙트를 한 개씩 보유하세요.',
      goal: together({ 'user.border_cosmetic_count': 1, 'user.name_effect_cosmetic_count': 1 }), rewards: [points(1400)] },
    { code: 'economy_wardrobe', name: '카드 옷장', tier: 'gold',
      description: '장착하지 않은 코스메틱을 다섯 종류 모으세요.',
      goal: snapshot('user.unique_cosmetic_count', 5), rewards: [points(2400)] },
    { code: 'economy_shop_regular', name: '정리하고 꾸미고', tier: 'gold',
      description: '보관함에서 카드 100장을 판매하고 꾸미기 상점에서 다섯 번 구매하세요.',
      goal: together({ 'card.sold.count': 100, 'shop.purchase.count': 5 }), rewards: [points(2600)] },
    { code: 'economy_display_case', name: '단장한 진열장', tier: 'platinum',
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
    { code: 'trade_album_swap', name: '서로 채운 카드첩', tier: 'silver',
      description: '교환 다섯 번을 성사시키고 스트리머 카드 20종을 보유하세요.',
      goal: together({ 'trade.completed.count': 5, 'inventory.unique_streamer_count': 20 }), rewards: [playTickets(1)] },
    { code: 'trade_neighbors', name: '교환대 마당발', tier: 'gold',
      description: '친구 다섯 명을 사귀고 누적 교환 12회를 달성하세요.',
      goal: together({ 'community.friend_count': 5, 'trade.completed.count': 12 }), rewards: [points(2300)] },
    { code: 'trade_exchange_desk', name: '교환대에서 장터까지', tier: 'platinum',
      description: '1:1 교환 50회와 오픈마켓 판매 완료 다섯 건을 기록하세요.',
      goal: together({ 'trade.completed.count': 50, 'market.sold_listing_count': 5 }), rewards: [drawTicket] }
  ] },
  { category: 'market', icon: 'Store', color: '#0f766e', entries: [
    { code: 'market_first_receipt', name: '첫 판매 영수증', tier: 'bronze',
      description: '오픈마켓에 올린 카드의 판매를 처음으로 완료하세요.',
      goal: snapshot('market.sold_listing_count', 1), rewards: [points(800)] },
    { code: 'market_wish_list', name: '알림 켜고 장도 보고', tier: 'silver',
      description: '마켓 관심 알림 두 개를 설정하고 구매 한 건을 완료하세요.',
      goal: together({ 'market.watch_count': 2, 'market.bought_listing_count': 1 }), rewards: [points(1300)] },
    { code: 'market_both_sides', name: '사고파는 재미', tier: 'silver',
      description: '오픈마켓에서 구매와 판매를 각각 세 건 완료하세요.',
      goal: together({ 'market.bought_listing_count': 3, 'market.sold_listing_count': 3 }), rewards: [points(1800)] },
    { code: 'market_two_price_tags', name: '두 가지 가격표', tier: 'silver',
      description: '고정가 판매와 경매를 한 건씩 동시에 열어 두세요.',
      goal: together({ 'market.active_fixed_listing_count': 1, 'market.active_auction_listing_count': 1 }), rewards: [points(900)] },
    { code: 'market_bidding_card', name: '경매장의 손님', tier: 'gold',
      description: '경매에 세 번 입찰하고 오픈마켓에서 카드 구매 다섯 건을 완료하세요.',
      goal: together({ 'market.bid.count': 3, 'market.bought_listing_count': 5 }), rewards: [points(2000)] },
    { code: 'market_long_ledger', name: '두꺼워진 거래 장부', tier: 'platinum',
      description: '마켓 판매 25건과 구매 10건이 담긴 거래 장부를 만드세요.',
      goal: together({ 'market.sold_listing_count': 25, 'market.bought_listing_count': 10 }), rewards: [drawTicket, points(1500)] }
  ] },
  { category: 'minigame', icon: 'Gamepad2', color: '#7c3aed', entries: [
    { code: 'arcade_quiz_eye', name: '흐릿해도 알아요', tier: 'silver',
      description: '정식 스트리머 퀴즈에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.quiz.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_matching_pairs', name: '이 둘이 한 쌍!', tier: 'silver',
      description: '정식 그림 짝맞추기에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.match.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_fan_queue', name: '줄은 이쪽입니다', tier: 'silver',
      description: '정식 팬 줄서기에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.fan_meeting.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_guest_spotter', name: '오늘의 게스트를 찾았다', tier: 'silver',
      description: '정식 게스트 캐치에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.streamer_catch.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_sequence_encore', name: '순서대로 한 번 더', tier: 'silver',
      description: '정식 순서 기억에서 다섯 번 성공하세요.',
      goal: counter('minigame.success.sequence_relay.count', 5), rewards: [playTickets(1)] },
    { code: 'arcade_faces_and_pairs', name: '얼굴도 짝도 척척', tier: 'gold',
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
    { code: 'community_greeting', name: '친구들이 읽을 한 줄', tier: 'silver',
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
    { code: 'mission_full_week', name: '도장 다섯 개', tier: 'gold',
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
    { code: 'secret_starlit_stairs', name: '별 도감 여섯 칸 완성', tier: 'platinum',
      description: '0성부터 5성까지 모든 등급의 카드를 한꺼번에 보관하세요.',
      hint: '별이 하나도 없는 카드도 도감의 한 칸입니다.',
      goal: snapshot('inventory.unique_star_level_count', 6), rewards: [drawTicket] },
    { code: 'secret_festival_staff', name: '무대 뒤의 진행자', tier: 'gold',
      description: '팬 줄서기, 게스트 캐치, 순서 기억에서 각각 열 번 성공하세요.',
      hint: '팬과 게스트를 맞이하고 출연 순서까지 기억해 보세요.',
      goal: together({ 'minigame.success.fan_meeting.count': 10, 'minigame.success.streamer_catch.count': 10,
        'minigame.success.sequence_relay.count': 10 }), rewards: [playTickets(2), points(1500)] },
    { code: 'secret_trade_triangle', name: '카드가 오가는 세 갈래 길', tier: 'gold',
      description: '1:1 교환과 오픈마켓 구매·판매를 각각 다섯 번 완료하세요.',
      hint: '카드가 오가는 방법은 한 가지가 아닙니다.',
      goal: together({ 'trade.completed.count': 5, 'market.bought_listing_count': 5, 'market.sold_listing_count': 5 }), rewards: [points(2700)] },
    { code: 'secret_mission_souvenir', name: '주간 도장도 카드도 차곡차곡', tier: 'platinum',
      description: '한 주의 미션 보상을 모두 받은 기록과 즐겨찾기 열 장을 모으세요.',
      hint: '주간 도장을 완성하고 즐겨찾기 진열장도 채워 보세요.',
      goal: together({ 'weekly_mission.full_week_count': 1, 'inventory.favorite_count': 10 }), rewards: [drawTicket] }
  ] }
];

export const additionalAchievements = groups.flatMap(({ category, icon, color, entries }) =>
  entries.map(({ goal, rewards, hint, ...entry }) => ({
    ...entry, category, icon, icon_color: color, ...goal, rewards_json: rewards,
    is_active: true, is_hidden: Boolean(hint), hidden_hint: hint ?? null,
    starts_at: null, ends_at: null, repeat_policy: 'once' as const, claim_policy: 'manual' as const, created_by: null
  }))
).map((entry, index) => ({ ...entry, sort_order: 1100 + index * 10 }));
