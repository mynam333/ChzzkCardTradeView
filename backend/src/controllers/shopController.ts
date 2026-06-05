import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import * as shop from '../services/shopService';

/**
 * CSS 코드를 압축합니다 (주석 제거, 연속 공백/줄바꿈 축소).
 * 단, SVG data URI가 포함된 url(...) 부분은 손상되지 않도록 보호합니다.
 */
const minifyCss = (css: string): string => {
  // 1. 주석 제거
  let minified = css.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // 2. url() 패턴 보호 (특히 Base64 인코딩이나 SVG data URI가 포함된 곳)
  const urls: string[] = [];
  minified = minified.replace(/url\((['"]?)(data:[\w+\/]+;base64,[\s\S]*?|data:image\/svg\+xml[\s\S]*?)\1\)/gi, (match) => {
    urls.push(match);
    return `___URL_PLACEHOLDER_${urls.length - 1}___`;
  });

  // 3. url 외 영역 공백 및 줄바꿈 압축
  minified = minified
    .replace(/\s+/g, ' ')               // 다중 공백 -> 단일 공백
    .replace(/\s*([\{\}:;\,])\s*/g, '$1') // 기호 주변 공백 제거
    .trim();

  // 4. 보호된 url 복원 및 url 내부 공백 제거 (SVG 내부는 연속된 공백과 줄바꿈을 공백 하나로 치환 가능)
  minified = minified.replace(/___URL_PLACEHOLDER_(\d+)___/g, (_, index) => {
    const originalUrl = urls[parseInt(index, 10)];
    return originalUrl.replace(/\s+/g, ' ');
  });

  return minified;
};

const fail = (res: Response, msg: string, err?: any) =>
  res.status(500).json({ error: 'InternalServerError', message: msg, details: IS_PRODUCTION ? undefined : err?.message });

/** 상점 활성 아이템 목록 (유저) */
export const getShopItems = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json(await shop.getActiveItems());
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
        : '구매에 실패했습니다.';
      return res.status(400).json({ error: 'BuyFailed', reason: r.reason, message: msg });
    }
    return res.status(200).json({ message: '구매가 완료되었습니다.' });
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
      return res.status(400).json({ error: 'EquipFailed', reason: r.reason, message: msg });
    }
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
    if (!r.ok) return res.status(400).json({ error: 'UnequipFailed', reason: r.reason, message: '해제에 실패했습니다.' });
    return res.status(200).json({ message: '해제되어 보유함으로 반환되었습니다.' });
  } catch (err) { return fail(res, '해제 처리 실패', err); }
};

// ===== 관리자 =====
export const adminGetShopItems = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json(await shop.getAllItems());
  } catch (err) { return fail(res, '상점 관리 목록 조회 실패', err); }
};

export const adminCreateShopItem = async (req: AuthenticatedRequest, res: Response) => {
  const { type, name, description, price, style_json, font_url, font_family, active, purchase_limit } = req.body;
  if (!['border', 'name_effect'].includes(type) || !name) {
    return res.status(400).json({ error: 'BadRequest', message: '종류(border|name_effect)와 이름이 필요합니다.' });
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
      purchase_limit: Math.max(0, Number(purchase_limit) || 0)
    });
    return res.status(201).json({ message: '아이템이 추가되었습니다.' });
  } catch (err) { return fail(res, '아이템 추가 실패', err); }
};

/** 특정 아이템의 1인 구매 횟수 전체 초기화 */
export const adminResetPurchases = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '아이템 ID가 필요합니다.' });
  try {
    await shop.resetPurchases(id);
    return res.status(200).json({ message: '해당 아이템의 구매 제한이 초기화되었습니다. (모든 유저 재구매 가능)' });
  } catch (err) { return fail(res, '구매 제한 초기화 실패', err); }
};

export const adminUpdateShopItem = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '아이템 ID가 필요합니다.' });
  
  const updateData = { ...req.body };
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
    return res.status(200).json({ message: '아이템이 수정되었습니다.' });
  } catch (err) { return fail(res, '아이템 수정 실패', err); }
};
