import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';

// Freeze both labels so a later catalog edit cannot change the meaning of this revision.
const revision = 'achievement_names_2026_11_20';
const nameChanges: ReadonlyArray<readonly [code: string, oldName: string, newName: string]> = [
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

export const applyAchievementNameRevision = async (): Promise<void> => {
  const mode = getDbMode();
  const update = 'UPDATE achievements SET name = ? WHERE code = ? AND ';
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    db.transaction(() => {
      const marker = db.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, '1')").run(revision);
      if (!marker.changes) return;
      const rename = db.prepare(update + 'name = ?');
      for (const [code, oldName, newName] of nameChanges) rename.run(newName, code, oldName);
    })();
  } else if (mode === 'MYSQL') {
    const db = getMysqlDb();
    if (await db.get('SELECT 1 FROM system_configs WHERE `key` = ?', revision)) return;
    // MySQL's default text comparison can ignore differences in an administrator's label.
    const sql = update + (getSqlDialect() === 'mysql' ? 'BINARY name = BINARY ?' : 'name = ?');
    await db.transaction(async tx => {
      const marker = await tx.run("INSERT IGNORE INTO system_configs (`key`, value) VALUES (?, '1')", revision);
      if (!marker.changes) return;
      for (const [code, oldName, newName] of nameChanges) await tx.run(sql, newName, code, oldName);
    });
  }
};
