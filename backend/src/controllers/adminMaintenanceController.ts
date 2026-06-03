import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDbMode, getSqliteDb, getSupabaseClient } from '../services/db';
import { streamerRepository } from '../repositories';
import { IS_PRODUCTION } from '../config';

const UPLOADS_DIR = path.join(__dirname, '../../../public/uploads');

// ============================================================
//  공용 DB 헬퍼 (SQLite / Supabase 양 모드)
// ============================================================
const wipeTable = async (table: string, col: string = 'id'): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const { error } = await getSupabaseClient().from(table).delete().not(col, 'is', null);
    if (error) throw error;
  } else {
    getSqliteDb().prepare(`DELETE FROM ${table}`).run();
  }
};

const clearCardCosmeticSlots = async (): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const { error } = await getSupabaseClient().from('user_cards').update({ border_item_id: null, name_effect_item_id: null }).not('id', 'is', null);
    if (error) throw error;
  } else {
    getSqliteDb().prepare('UPDATE user_cards SET border_item_id = NULL, name_effect_item_id = NULL').run();
  }
};

const resetAllPoints = async (): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const { error } = await getSupabaseClient().from('users').update({ point: 0 }).not('id', 'is', null);
    if (error) throw error;
  } else {
    getSqliteDb().prepare('UPDATE users SET point = 0').run();
  }
};

// 모든 스트리머 카드 가치를 초기값(팔로워 수)으로 리셋 (시세 이력 초기화와 함께 사용)
const resetStreamerValuesToFollowers = async (): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const client = getSupabaseClient();
    const { data, error } = await client.from('streamers').select('channel_id, follower_count');
    if (error) throw error;
    for (const s of data || []) {
      const v = (s as any).follower_count || 0;
      const { error: uErr } = await client.from('streamers')
        .update({ base_value: v, prev_value: v, updated_at: new Date().toISOString() })
        .eq('channel_id', (s as any).channel_id);
      if (uErr) throw uErr;
    }
  } else {
    getSqliteDb().prepare(
      "UPDATE streamers SET base_value = follower_count, prev_value = follower_count, updated_at = datetime('now')"
    ).run();
  }
};

const countTable = async (table: string): Promise<number> => {
  if (getDbMode() === 'SUPABASE') {
    const { count } = await getSupabaseClient().from(table).select('*', { count: 'exact', head: true });
    return count || 0;
  }
  const r = getSqliteDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as any;
  return r?.c || 0;
};

// ============================================================
//  초기화 카테고리 정의
//  (유저 가입/로그인 · 스트리머 등록 · 카드 이미지 정보는 제외)
// ============================================================
const CATEGORIES: { id: string; label: string; description: string; countTable: string; run: () => Promise<void> }[] = [
  { id: 'user_cards', label: '유저 보유 카드', description: '모든 유저의 보유 카드를 삭제합니다.', countTable: 'user_cards', run: () => wipeTable('user_cards') },
  { id: 'trades', label: '교환(진행/이력)', description: '진행 중·완료된 모든 교환 기록을 삭제합니다.', countTable: 'trades', run: () => wipeTable('trades') },
  { id: 'coupons', label: '쿠폰·사용기록', description: '발급된 쿠폰과 사용 로그를 삭제합니다.', countTable: 'coupons', run: async () => { await wipeTable('coupon_logs'); await wipeTable('coupons'); } },
  { id: 'cosmetics', label: '코스메틱 보유/구매', description: '유저 보유 코스메틱·구매 내역을 삭제하고 카드 장착을 해제합니다.', countTable: 'user_cosmetics', run: async () => { await clearCardCosmeticSlots(); await wipeTable('user_cosmetics'); await wipeTable('shop_purchases', 'user_id'); } },
  { id: 'shop_items', label: '상점 아이템 카탈로그', description: '상점 아이템 전체를 삭제합니다(보유·구매 내역 포함, 카드 장착 해제).', countTable: 'shop_items', run: async () => { await clearCardCosmeticSlots(); await wipeTable('shop_items'); } },
  { id: 'notifications', label: '인앱 알림', description: '모든 인앱 알림을 삭제합니다.', countTable: 'notifications', run: () => wipeTable('notifications') },
  { id: 'push', label: '푸시 구독/예약', description: '웹푸시 구독과 예약 발송 내역을 삭제합니다.', countTable: 'push_subscriptions', run: async () => { await wipeTable('push_notifications'); await wipeTable('push_subscriptions'); } },
  { id: 'announcements', label: '공지', description: '모든 공지를 삭제합니다.', countTable: 'announcements', run: () => wipeTable('announcements') },
  { id: 'reports', label: '카드 신고', description: '카드 신고 내역을 삭제합니다.', countTable: 'card_reports', run: () => wipeTable('card_reports') },
  { id: 'value_history', label: '시세 이력', description: '시세 이력을 삭제하고, 모든 카드 가치를 초기값(팔로워 수)으로 되돌립니다.', countTable: 'value_history', run: async () => { await wipeTable('value_history'); await resetStreamerValuesToFollowers(); } },
  { id: 'blocks', label: '유저 차단', description: '모든 유저 차단 관계를 삭제합니다.', countTable: 'user_blocks', run: () => wipeTable('user_blocks', 'blocker_id') },
  { id: 'points', label: '유저 포인트 초기화(0)', description: '모든 유저의 보유 포인트를 0으로 만듭니다.', countTable: 'users', run: () => resetAllPoints() },
];

/** 초기화 가능한 카테고리 목록 + 현재 데이터 수량 */
export const getResetInfo = async (_req: Request, res: Response) => {
  try {
    const out = [];
    for (const c of CATEGORIES) {
      out.push({ id: c.id, label: c.label, description: c.description, count: await countTable(c.countTable).catch(() => 0) });
    }
    return res.status(200).json(out);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '초기화 정보 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/** 선택한 카테고리들을 초기화 */
export const resetData = async (req: Request, res: Response) => {
  const categories: string[] = Array.isArray(req.body?.categories) ? req.body.categories : [];
  if (categories.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '초기화할 항목을 1개 이상 선택해 주세요.' });
  }
  const selected = CATEGORIES.filter((c) => categories.includes(c.id));
  if (selected.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '유효한 초기화 항목이 없습니다.' });
  }
  try {
    const done: string[] = [];
    for (const c of selected) {
      await c.run();
      done.push(c.label);
    }
    return res.status(200).json({
      message: `초기화 완료: ${done.join(', ')}`,
      reset: done
    });
  } catch (err: any) {
    console.error('[AdminMaintenance] resetData 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '초기화 처리 중 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

// ============================================================
//  미사용 업로드 이미지 정리
// ============================================================
const IMAGE_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif']);

/** uploads 하위 모든 이미지 파일의 상대경로(posix) 목록 */
const listUploadFiles = (): { rel: string; size: number }[] => {
  const out: { rel: string; size: number }[] = [];
  if (!fs.existsSync(UPLOADS_DIR)) return out;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const rel = path.relative(UPLOADS_DIR, full).split(path.sep).join('/');
      let size = 0;
      try { size = fs.statSync(full).size; } catch { /* noop */ }
      out.push({ rel, size });
    }
  };
  walk(UPLOADS_DIR);
  return out;
};

/** 스트리머 커스텀 이미지로 참조 중인 파일 상대경로 집합 */
const getReferencedRels = async (): Promise<Set<string>> => {
  const refs = new Set<string>();
  const toRel = (u?: string | null) => {
    if (!u) return;
    let pth = u;
    try { pth = new URL(u).pathname; } catch { /* 상대경로일 수 있음 */ }
    const i = pth.indexOf('/uploads/');
    if (i < 0) return;
    try { refs.add(decodeURIComponent(pth.slice(i + '/uploads/'.length))); }
    catch { refs.add(pth.slice(i + '/uploads/'.length)); }
  };
  const streamers = await streamerRepository.findAll();
  for (const s of streamers) {
    toRel(s.custom_image_url);
    for (const img of (s.custom_images || [])) toRel(img);
  }
  return refs;
};

/** 프론트(스트리머 카드 이미지)에 연결되지 않은 업로드 이미지 목록 */
export const listOrphanImages = async (req: Request, res: Response) => {
  try {
    const files = listUploadFiles();
    const refs = await getReferencedRels();
    const base = (process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const orphans = files
      .filter((f) => !refs.has(f.rel))
      .map((f) => ({
        rel: f.rel,
        size: f.size,
        url: `${base}/uploads/${f.rel.split('/').map(encodeURIComponent).join('/')}`
      }));
    return res.status(200).json({ count: orphans.length, total_files: files.length, referenced: refs.size, orphans });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '미사용 이미지 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/** 선택한 미사용 업로드 이미지 삭제 */
export const deleteOrphanImages = async (req: Request, res: Response) => {
  const rels: string[] = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (rels.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '삭제할 이미지를 선택해 주세요.' });
  }
  try {
    const refs = await getReferencedRels();
    let deleted = 0;
    const skipped: string[] = [];
    for (const raw of rels) {
      const rel = String(raw).replace(/^\/?uploads\//, '').replace(/^\/+/, '');
      // 경로 탈출 방지: uploads 디렉터리 내부인지 검증
      const target = path.resolve(UPLOADS_DIR, rel);
      const relCheck = path.relative(UPLOADS_DIR, target);
      if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) { skipped.push(rel); continue; }
      // 참조 중(사용 중)인 이미지는 안전상 건너뜀
      if (refs.has(rel)) { skipped.push(rel); continue; }
      try {
        if (fs.existsSync(target) && fs.statSync(target).isFile()) { fs.unlinkSync(target); deleted++; }
      } catch { skipped.push(rel); }
    }
    // 비어버린 하위 폴더 정리
    try {
      for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(UPLOADS_DIR, entry.name);
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      }
    } catch { /* noop */ }
    return res.status(200).json({ message: `${deleted}개의 이미지를 삭제했습니다.`, deleted, skipped: skipped.length });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '미사용 이미지 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
