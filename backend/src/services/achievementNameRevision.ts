import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';

type NameChange = readonly [code: string, oldName: string, newName: string];

// Keep each released list immutable so sites can upgrade across multiple releases.
const originalChanges: readonly NameChange[] = [
  ['first_market_purchase', '첫 마켓 구매', '장터에서 산 첫 카드'],
  ['30_days_straight', '꾸준한 개근', '한 달 개근'],
  ['100_days_straight', '당신은 개근왕', '100일 개근왕'],
  ['get_10', '가챠는 못참지', '가챠는 못 참지'],
  ['100_minigame_win', '백전백승', '백 번째 승리'],
  ['get_100', '가챠중독', '가챠 중독'],
  ['unique_streamers_300', '광적인 콜렉터', '카드 수집광'],
  ['fortnight_favorites', '보름 동안 고른 최애', '출석 도장 열다섯, 최애 셋'],
  ['album_first_print', '세상에 한 장뿐인 1번', '시리얼 1번은 내 거'],
  ['album_deep_shelves', '천 장의 서가', '천 장이나 모았다'],
  ['growth_constellation', '마흔 개의 별자리', '모아 보니 별이 마흔 개'],
  ['growth_front_row', '별들의 앞줄', '4성과 5성이 한자리에'],
  ['economy_two_finishes', '테두리와 이름 한 벌', '테두리도 이름 이펙트도'],
  ['economy_wardrobe', '카드의 옷장', '카드 옷장'],
  ['trade_neighbors', '수집가의 연락망', '교환대 마당발'],
  ['market_wish_list', '관심 목록을 들고', '알림 켜고 장도 보고'],
  ['market_both_sides', '계산대 양쪽에서', '사고파는 재미'],
  ['arcade_matching_pairs', '짝 맞추는 손', '이 둘이 한 쌍!'],
  ['arcade_guest_spotter', '오늘의 게스트 발견', '오늘의 게스트를 찾았다'],
  ['arcade_sequence_encore', '순서대로 앙코르', '순서대로 한 번 더'],
  ['community_greeting', '친구들에게 보내는 한 줄', '친구들이 읽을 한 줄'],
  ['secret_starlit_stairs', '별 여섯 칸의 계단', '별 도감 여섯 칸 완성'],
  ['secret_trade_triangle', '카드가 도는 세 갈래 길', '카드가 오가는 세 갈래 길'],
  ['secret_mission_souvenir', '한 주의 기념 진열장', '주간 도장도 카드도 차곡차곡']
];

const idiomChanges: readonly NameChange[] = [
  ['five_star_owner', '최고 등급', '하늘의 별 따기'],
  ['first_shop_purchase', '첫 꾸미기 쇼핑', '지름신 강림'],
  ['first_market_purchase', '장터에서 산 첫 카드', '첫 마켓 구매'],
  ['30_days_straight', '한 달 개근', '하루도 빠짐없이'],
  ['100_days_straight', '100일 개근왕', '당신은 개근왕'],
  ['100_minigame_win', '백 번째 승리', '백전백승'],
  ['get_100', '가챠 중독', '딱 한 번만 더'],
  ['fortnight_favorites', '출석 도장 열다섯, 최애 셋', '보름 동안 고른 최애'],
  ['fortnight_album', '매일 채운 카드첩', '작심삼일 탈출'],
  ['album_keepsakes', '간직할 카드들', '금이야 옥이야'],
  ['album_early_print', '앞번호의 행운', '열 손가락 안에 든 카드'],
  ['album_star_palette', '네 칸의 별 도감', '각양각색'],
  ['album_first_print', '시리얼 1번은 내 거', '세상에 한 장뿐인 1번'],
  ['album_deep_shelves', '천 장이나 모았다', '티끌 모아 태산'],
  ['growth_constellation', '모아 보니 별이 마흔 개', '별 헤는 밤'],
  ['growth_front_row', '4성과 5성이 한자리에', '별들의 잔치'],
  ['growth_master_bench', '한계돌파 장인의 작업대', '장인의 손길'],
  ['economy_clear_a_shelf', '빈자리가 생겼어요', '보관함 대청소'],
  ['economy_two_finishes', '테두리도 이름 이펙트도', '이왕이면 세트로'],
  ['economy_wardrobe', '카드 옷장', '골라 입는 재미'],
  ['economy_shop_regular', '정리하고 꾸미고', '꿩 먹고 알 먹고'],
  ['economy_display_case', '단장한 진열장', '옷이 날개'],
  ['trade_album_swap', '서로 채운 카드첩', '누이 좋고 매부 좋고'],
  ['trade_neighbors', '교환대 마당발', '발이 넓은 수집가'],
  ['market_first_receipt', '첫 판매 영수증', '마수걸이'],
  ['market_wish_list', '알림 켜고 장도 보고', '눈독 들인 카드'],
  ['market_both_sides', '사고파는 재미', '주거니 받거니'],
  ['market_bidding_card', '경매장의 손님', '경매는 눈치 싸움'],
  ['market_long_ledger', '두꺼워진 거래 장부', '장터 터줏대감'],
  ['arcade_matching_pairs', '이 둘이 한 쌍!', '찰떡궁합'],
  ['arcade_guest_spotter', '오늘의 게스트를 찾았다', '매의 눈'],
  ['arcade_sequence_encore', '순서대로 한 번 더', '눈 감고도 한다'],
  ['arcade_faces_and_pairs', '얼굴도 짝도 척척', '척하면 척'],
  ['community_greeting', '친구들이 읽을 한 줄', '안부 한 줄'],
  ['mission_full_week', '도장 다섯 개', '이번 주 숙제 끝!'],
  ['secret_starlit_stairs', '별 도감 여섯 칸 완성', '별별 게 다 있네'],
  ['secret_festival_staff', '무대 뒤의 진행자', '팔방미인'],
  ['secret_trade_triangle', '카드가 오가는 세 갈래 길', '거래의 고수'],
  ['secret_mission_souvenir', '주간 도장도 카드도 차곡차곡', '두 마리 토끼']
];

const revisions = [
  { key: 'achievement_names_2026_11_20', changes: originalChanges },
  { key: 'achievement_names_2026_11_20_idioms', changes: idiomChanges }
];

export const applyAchievementNameRevision = async (): Promise<void> => {
  const mode = getDbMode();
  const update = 'UPDATE achievements SET name = ? WHERE code = ? AND ';
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    db.transaction(() => {
      const reserve = db.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, '1')");
      const rename = db.prepare(update + 'name = ?');
      for (const { key, changes } of revisions) {
        if (!reserve.run(key).changes) continue;
        for (const [code, oldName, newName] of changes) rename.run(newName, code, oldName);
      }
    })();
  } else if (mode === 'MYSQL') {
    const db = getMysqlDb();
    // MySQL's default text comparison can ignore differences in an administrator's label.
    const sql = update + (getSqlDialect() === 'mysql' ? 'BINARY name = BINARY ?' : 'name = ?');
    for (const { key, changes } of revisions) {
      if (await db.get('SELECT 1 FROM system_configs WHERE `key` = ?', key)) continue;
      await db.transaction(async tx => {
        const marker = await tx.run("INSERT IGNORE INTO system_configs (`key`, value) VALUES (?, '1')", key);
        if (!marker.changes) return;
        for (const [code, oldName, newName] of changes) await tx.run(sql, newName, code, oldName);
      });
    }
  }
};
