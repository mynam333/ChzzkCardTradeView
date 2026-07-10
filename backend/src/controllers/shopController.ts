import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import * as shop from '../services/shopService';
import { minifyCss } from '../utils/css';
import { publishRealtimeEvent } from '../services/realtimeStream';
import { recordAchievementEvent } from '../services/achievementService';
import { getUploadsDir } from '../services/storagePaths';
import { isArenaV2MatchParticipant } from '../services/arenaV2Service';

const fail = (res: Response, msg: string, err?: any) =>
  res.status(500).json({ error: 'InternalServerError', message: msg, details: IS_PRODUCTION ? undefined : err?.message });

const publishShopUpdated = (reason: string, extra: Record<string, unknown> = {}) => {
  publishRealtimeEvent('shop', { reason, ...extra });
};

/** 상점 활성 아이템 목록 (유저) */
export const getShopItems = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = (await shop.getActiveItems()).filter((item) => item.type === 'border' || item.type === 'name_effect');
    const body = JSON.stringify(items);
    const etag = `"shop-items-${crypto.createHash('sha1').update(body).digest('hex')}"`;
    res.set('Cache-Control', 'private, no-cache');
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    return res.status(200).type('application/json').send(body);
  } catch (err) { return fail(res, '상점 목록 조회 실패', err); }
};

/** 내 보유 코스메틱 */
export const getMyCosmetics = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.status(200).json(await shop.getUserCosmetics(userId));
  } catch (err) { return fail(res, '보유 코스메틱 조회 실패', err); }
};

/** 상점 목록 표시용 내 보유 수량 맵 */
export const getMyCosmeticCounts = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(await shop.getUserCosmeticCounts(userId));
  } catch (err) { return fail(res, '보유 코스메틱 수량 조회 실패', err); }
};

/** 내 아이템별 구매 횟수 맵 (구매 제한 표시용) */
export const getMyPurchases = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.status(200).json(await shop.getUserPurchases(userId));
  } catch (err) { return fail(res, '구매 내역 조회 실패', err); }
};

/** 구매 */
export const buyShopItem = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const itemId = Number(req.body.item_id);
  if (!itemId) return res.status(400).json({ error: 'BadRequest', message: '구매할 아이템 ID가 필요합니다.' });
  try {
    const r = await shop.buyItem(userId, itemId);
    if (!r.ok) {
      const msg = r.reason === 'INSUFFICIENT_POINT' ? '포인트가 부족합니다.'
        : r.reason === 'NOT_FOUND' ? '판매 중인 아이템이 아닙니다.'
        : r.reason === 'LIMIT_REACHED' ? '이 아이템의 최대 구매 갯수에 도달했습니다.'
        : r.reason === 'SALE_NOT_STARTED' ? '아직 판매가 시작되지 않은 한정 상품입니다.'
        : r.reason === 'SALE_ENDED' ? '판매 기간이 종료된 한정 상품입니다.'
        : r.reason === 'SOLD_OUT' ? '준비된 한정 수량이 모두 판매되었습니다.'
        : '구매에 실패했습니다.';
      return res.status(400).json({ error: 'BuyFailed', reason: r.reason, message: msg });
    }
    if (r.catalogChanged) {
      publishShopUpdated('item_purchased', { itemId });
    }
    recordAchievementEvent({
      userId,
      eventType: 'shop.purchase',
      eventKey: `shop:purchase:${userId}:${itemId}:${crypto.randomUUID()}`,
      metadata: { item_id: itemId },
      stats: { 'shop.purchase.count': 1 },
      refreshSnapshots: true
    }).catch(() => undefined);
    return res.status(200).json({ message: '구매가 완료되었습니다.', catalogChanged: !!r.catalogChanged });
  } catch (err) { return fail(res, '구매 처리 실패', err); }
};

/** 카드에 코스메틱 장착 */
export const equipToCard = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const cardId = Number(req.params.card_id);
  const itemId = Number(req.body.item_id);
  if (!cardId || !itemId) return res.status(400).json({ error: 'BadRequest', message: '카드 ID와 아이템 ID가 필요합니다.' });
  try {
    const r = await shop.equipCosmetic(userId, cardId, itemId);
    if (!r.ok) {
      const msg = r.reason === 'NOT_OWNED' ? '보유하지 않은 코스메틱입니다.' : r.reason === 'CARD_NOT_FOUND' ? '내 카드가 아닙니다.' : '장착에 실패했습니다.';
      return res.status(400).json({ error: 'EquipFailed', reason: r.reason, message: r.reason === 'CARD_LOCKED' ? '잠금된 카드에는 코스메틱을 장착할 수 없습니다.' : msg });
    }
    recordAchievementEvent({
      userId,
      eventType: 'cosmetic.equip',
      eventKey: `cosmetic:equip:${userId}:${cardId}:${itemId}:${crypto.randomUUID()}`,
      metadata: { card_id: cardId, item_id: itemId },
      stats: { 'cosmetic.equip.count': 1 },
      refreshSnapshots: true
    }).catch(() => undefined);
    return res.status(200).json({ message: '장착되었습니다.' });
  } catch (err) { return fail(res, '장착 처리 실패', err); }
};

/** 카드에서 코스메틱 해제(반환) */
export const unequipFromCard = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const cardId = Number(req.params.card_id);
  const type = req.body.type;
  if (!cardId || !['border', 'name_effect'].includes(type)) {
    return res.status(400).json({ error: 'BadRequest', message: '카드 ID와 종류(border|name_effect)가 필요합니다.' });
  }
  try {
    const r = await shop.unequipCosmetic(userId, cardId, type);
    if (!r.ok) return res.status(400).json({ error: 'UnequipFailed', reason: r.reason, message: r.reason === 'CARD_LOCKED' ? '잠금된 카드는 코스메틱을 해제할 수 없습니다.' : '해제에 실패했습니다.' });
    return res.status(200).json({ message: '해제되어 보유함으로 반환되었습니다.' });
  } catch (err) { return fail(res, '해제 처리 실패', err); }
};

// ===== 관리자 =====
export const adminGetShopItems = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json(await shop.getAllItems());
  } catch (err) { return fail(res, '상점 관리 목록 조회 실패', err); }
};

/** 아레나 V2 관리자 전용 치장 카탈로그 */
export const adminGetArenaCosmetics = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const items = (await shop.getAllItems()).filter((item) => shop.isArenaCosmeticType(item.type));
    return res.status(200).json(items);
  } catch (err) { return fail(res, '아레나 치장 관리 목록 조회 실패', err); }
};

export const adminCreateShopItem = async (req: AuthenticatedRequest, res: Response) => {
  const { type, name, description, price, style_json, font_url, font_family, active, purchase_limit, sale_start_at, sale_end_at, limited_total_quantity } = req.body;
  if (!(['border', 'name_effect'].includes(type) || shop.isArenaCosmeticType(type)) || !name) {
    return res.status(400).json({ error: 'BadRequest', message: '지원하는 코스메틱 종류와 이름이 필요합니다.' });
  }
  
  let processedStyleJson = style_json;
  if (style_json) {
    try {
      const parsed = JSON.parse(style_json);
      if (parsed.css && typeof parsed.css === 'string') {
        parsed.css = minifyCss(parsed.css);
      }
      processedStyleJson = JSON.stringify(parsed);
    } catch {
      return res.status(400).json({ error: 'BadRequest', message: '스타일(JSON) 형식이 올바르지 않습니다.' });
    }
  }

  try {
    await shop.createItem({
      type,
      name,
      description: description ?? null,
      price: Math.max(0, Number(price) || 0),
      style_json: processedStyleJson ?? null,
      font_url: font_url ?? null,
      font_family: font_family ?? null,
      active,
      purchase_limit: Math.max(0, Number(purchase_limit) || 0),
      sale_start_at: sale_start_at || null,
      sale_end_at: sale_end_at || null,
      limited_total_quantity: Math.max(0, Number(limited_total_quantity) || 0),
      sold_quantity: 0
    });
    publishShopUpdated('item_created');
    return res.status(201).json({ message: '아이템이 추가되었습니다.' });
  } catch (err) { return fail(res, '아이템 추가 실패', err); }
};

export const adminCreateArenaCosmetic = async (req: AuthenticatedRequest, res: Response) => {
  if (!shop.isArenaCosmeticType(req.body?.type)) {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 아레나 치장 종류입니다.' });
  }
  return adminCreateShopItem(req, res);
};

/** 특정 아이템의 1인 구매 횟수 전체 초기화 */
export const adminResetPurchases = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '아이템 ID가 필요합니다.' });
  try {
    await shop.resetPurchases(id);
    publishShopUpdated('purchases_reset', { itemId: id });
    return res.status(200).json({ message: '해당 아이템의 구매 제한이 초기화되었습니다. (모든 유저 재구매 가능)' });
  } catch (err) { return fail(res, '구매 제한 초기화 실패', err); }
};

export const adminUpdateShopItem = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '아이템 ID가 필요합니다.' });
  
  const updateData = { ...req.body };
  if (updateData.type !== undefined && !(['border', 'name_effect'].includes(updateData.type) || shop.isArenaCosmeticType(updateData.type))) {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 코스메틱 종류입니다.' });
  }
  if (updateData.style_json) {
    try {
      const parsed = JSON.parse(updateData.style_json);
      if (parsed.css && typeof parsed.css === 'string') {
        parsed.css = minifyCss(parsed.css);
      }
      updateData.style_json = JSON.stringify(parsed);
    } catch {
      return res.status(400).json({ error: 'BadRequest', message: '스타일(JSON) 형식이 올바르지 않습니다.' });
    }
  }

  try {
    await shop.updateItem(id, updateData);
    publishShopUpdated('item_updated', { itemId: id });
    return res.status(200).json({ message: '아이템이 수정되었습니다.' });
  } catch (err) { return fail(res, '아이템 수정 실패', err); }
};

export const adminUpdateArenaCosmetic = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '치장 ID가 필요합니다.' });
  try {
    const item = await shop.getItem(id);
    if (!item || !shop.isArenaCosmeticType(item.type)) {
      return res.status(404).json({ error: 'NotFound', message: '아레나 치장을 찾을 수 없습니다.' });
    }
    if (req.body?.type !== undefined && !shop.isArenaCosmeticType(req.body.type)) {
      return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 아레나 치장 종류입니다.' });
    }
    return adminUpdateShopItem(req, res);
  } catch (err) { return fail(res, '아레나 치장 수정 실패', err); }
};

const storeArenaCosmeticAsset = async (
  req: AuthenticatedRequest,
  res: Response,
  forcedType?: shop.ArenaCosmeticType
) => {
  if (!req.file) return res.status(400).json({ error: 'BadRequest', message: '업로드할 이미지 파일이 필요합니다.' });
  try {
    const extByFormat: Record<string, string> = {
      jpeg: 'jpg',
      png: 'png',
      webp: 'webp',
      gif: 'gif',
      avif: 'avif'
    };
    const metadata = await sharp(req.file.buffer, { animated: true, limitInputPixels: 40_000_000 })
      .metadata()
      .catch(() => null);
    const ext = metadata?.format ? extByFormat[metadata.format] : null;
    if (!metadata || !ext || !metadata.width || !metadata.height) {
      return res.status(400).json({ error: 'BadRequest', message: '손상되었거나 지원하지 않는 이미지입니다.' });
    }
    const cosmeticType = forcedType || (shop.isArenaCosmeticType(req.body?.type) ? req.body.type : null);
    if (!cosmeticType) {
      return res.status(400).json({ error: 'BadRequest', message: '업로드할 아레나 치장 종류가 필요합니다.' });
    }
    const uploadDir = path.join(getUploadsDir(), 'arena-cosmetics');
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = `arena_${cosmeticType}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, req.file.buffer);
    const imageUrl = `/uploads/arena-cosmetics/${encodeURIComponent(fileName)}`;
    return res.status(200).json({
      message: '아레나 치장 이미지가 업로드되었습니다.',
      data: {
        image_url: imageUrl,
        mime_type: req.file.mimetype,
        width: metadata.width,
        height: metadata.height,
        animated: Number(metadata.pages || 1) > 1,
        cosmetic_type: cosmeticType
      }
    });
  } catch (err) {
    return fail(res, '아레나 치장 이미지 업로드 실패', err);
  }
};

export const uploadArenaCosmeticAsset = async (req: AuthenticatedRequest, res: Response) => storeArenaCosmeticAsset(req, res);

/** 기존 이모트 업로드 URL 호환용 */
export const uploadArenaEmoteAsset = async (req: AuthenticatedRequest, res: Response) => storeArenaCosmeticAsset(req, res, 'emote');

export const getArenaCosmeticShopItems = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json({ items: await shop.getArenaCosmeticShopItems() });
  } catch (err) { return fail(res, '아레나 상점 조회 실패', err); }
};

export const getArenaCosmeticInventoryCounts = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.status(200).json(await shop.getArenaUserCosmeticCounts(userId));
  } catch (err) { return fail(res, '아레나 코스메틱 보유 수량 조회 실패', err); }
};

export const getArenaCosmeticPurchases = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.status(200).json(await shop.getArenaUserPurchases(userId));
  } catch (err) { return fail(res, '아레나 코스메틱 구매 내역 조회 실패', err); }
};

export const getArenaCosmeticLoadout = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.status(200).json(await shop.getArenaCosmeticLoadout(userId));
  } catch (err) { return fail(res, '아레나 코스메틱 장착 정보 조회 실패', err); }
};

export const updateArenaCosmeticLoadout = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const result = await shop.updateArenaCosmeticLoadout(userId, {
      emoteSlots: req.body?.emoteSlots,
      equipped: req.body?.equipped
    });
    if (!result.ok) {
      return res.status(400).json({
        error: 'ArenaCosmeticLoadoutInvalid',
        reason: result.reason,
        message: result.reason === 'NOT_OWNED'
          ? '보유하지 않은 치장은 장착할 수 없습니다.'
          : result.reason === 'DUPLICATE_EMOTE'
            ? '같은 이모트를 여러 슬롯에 장착할 수 없습니다.'
            : result.reason === 'WRONG_TYPE'
              ? '치장 종류와 장착 슬롯이 일치하지 않습니다.'
              : '장착 정보를 저장하지 못했습니다.'
      });
    }
    return res.status(200).json(result.loadout);
  } catch (err) { return fail(res, '아레나 코스메틱 장착 정보 저장 실패', err); }
};

export const buyArenaCosmetic = async (req: AuthenticatedRequest, res: Response) => {
  const itemId = Number(req.body.item_id);
  if (!itemId) return res.status(400).json({ error: 'BadRequest', message: '구매할 아이템 ID가 필요합니다.' });
  const item = await shop.getItem(itemId);
  if (!item || !shop.isArenaCosmeticType(item.type)) {
    return res.status(400).json({ error: 'ArenaCosmeticTypeInvalid', message: '아레나 전용 치장만 구매할 수 있습니다.' });
  }
  return buyShopItem(req, res);
};

export const sendArenaEmote = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const matchId = String(req.params?.match_id || req.body?.matchId || '').trim();
  const itemId = Number(req.body?.itemId || req.body?.item_id);
  const x = Math.max(0, Math.min(1, Number(req.body?.x)));
  const y = Math.max(0, Math.min(1, Number(req.body?.y)));
  if (!matchId || !itemId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'ArenaEmoteInvalid', message: '매치, 이모트, 위치 정보가 필요합니다.' });
  }
  try {
    const participant = await isArenaV2MatchParticipant(matchId, userId);
    if (!participant) return res.status(403).json({ error: 'ArenaEmoteForbidden', message: '해당 매치 참가자만 이모트를 사용할 수 있습니다.' });
    const item = await shop.getArenaEquippedEmote(userId, itemId);
    if (!item) return res.status(400).json({ error: 'ArenaEmoteNotEquipped', message: '장착한 이모트만 사용할 수 있습니다.' });
    const event = {
      id: crypto.randomUUID(),
      kind: 'arena_emote',
      matchId,
      userId,
      item,
      x,
      y,
      createdAt: new Date().toISOString()
    };
    publishRealtimeEvent('arena', event);
    return res.status(200).json({ event });
  } catch (err) { return fail(res, '아레나 이모트 사용 실패', err); }
};
