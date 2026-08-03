import type { Server } from 'http';
import express, { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  const respondWithParsedStyleLength = (label: string) =>
    vi.fn((req: any, res: any) => {
      order.push(label);
      return res.status(200).json({ styleLength: String(req.body?.style_json || '').length });
    });

  return {
    order,
    create: respondWithParsedStyleLength('controller:create'),
    update: respondWithParsedStyleLength('controller:update'),
    reset: vi.fn((_req: any, res: any) => {
      order.push('controller:reset');
      return res.status(200).json({ ok: true });
    })
  };
});

vi.mock('../middlewares/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    mocks.order.push('auth');
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: 'test-user', role };
    return next();
  }
}));

vi.mock('../middlewares/admin', () => ({
  adminMiddleware: (req: any, res: any, next: any) => {
    mocks.order.push('admin');
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
    return next();
  }
}));

vi.mock('../middlewares/maintenanceCheck', () => ({
  maintenanceCheckMiddleware: (_req: any, _res: any, next: any) => next()
}));

vi.mock('../controllers/shopController', () => {
  const unused = (_req: any, res: any) => res.status(501).end();
  return {
    getShopItems: unused,
    getMyCosmetics: unused,
    getMyCosmeticCounts: unused,
    getMyPurchases: unused,
    buyShopItem: unused,
    equipToCard: unused,
    unequipFromCard: unused,
    adminGetShopItems: unused,
    adminCreateShopItem: mocks.create,
    adminUpdateShopItem: mocks.update,
    adminResetPurchases: mocks.reset,
    adminGetArenaCosmetics: unused,
    adminCreateArenaCosmetic: unused,
    adminUpdateArenaCosmetic: unused,
    uploadArenaCosmeticAsset: unused,
    uploadArenaEmoteAsset: unused,
    getArenaCosmeticShopItems: unused,
    getArenaCosmeticInventoryCounts: unused,
    getArenaCosmeticPurchases: unused,
    getArenaCosmeticLoadout: unused,
    updateArenaCosmeticLoadout: unused,
    buyArenaCosmetic: unused,
    sendArenaEmote: unused
  };
});

import apiRouter, { shouldDeferAdminShopItemBodyParsing } from '../routes/api';

const TEST_DEFAULT_BODY_LIMIT = '2kb';
const largeStyle = 'x'.repeat(4096);
const largeJsonBody = JSON.stringify({ style_json: largeStyle });

const makeTestApp = () => {
  const app = express();
  const defaultJsonParser = express.json({ limit: TEST_DEFAULT_BODY_LIMIT });
  const defaultUrlencodedParser = express.urlencoded({ limit: TEST_DEFAULT_BODY_LIMIT, extended: true });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldDeferAdminShopItemBodyParsing(req.method, req.path)) return next();
    return defaultJsonParser(req, res, next);
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldDeferAdminShopItemBodyParsing(req.method, req.path)) return next();
    return defaultUrlencodedParser(req, res, next);
  });
  app.use('/api', apiRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    return res.status(err?.status || err?.statusCode || 500).json({ error: err?.type || 'Error' });
  });

  return app;
};

describe('admin shop item body limit routing', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = makeTestApp();
    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('테스트 서버 포트를 확인할 수 없습니다.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    mocks.order.length = 0;
    vi.clearAllMocks();
  });

  it('defers only create and numeric-id update POST paths', () => {
    expect(shouldDeferAdminShopItemBodyParsing('POST', '/api/admin/shop/items')).toBe(true);
    expect(shouldDeferAdminShopItemBodyParsing('post', '/api/admin/shop/items/123')).toBe(true);
    expect(shouldDeferAdminShopItemBodyParsing('POST', '/api/admin/shop/items/123/')).toBe(true);

    expect(shouldDeferAdminShopItemBodyParsing('GET', '/api/admin/shop/items')).toBe(false);
    expect(shouldDeferAdminShopItemBodyParsing('POST', '/api/admin/shop/items/not-a-number')).toBe(false);
    expect(shouldDeferAdminShopItemBodyParsing('POST', '/api/admin/shop/items/123/reset-purchases')).toBe(false);
    expect(shouldDeferAdminShopItemBodyParsing('POST', '/api/shop/items')).toBe(false);
  });

  it('rejects unauthenticated malformed large JSON before deferred parsing', async () => {
    const response = await fetch(`${baseUrl}/api/admin/shop/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{${largeStyle}`
    });

    expect(response.status).toBe(401);
    expect(mocks.order).toEqual(['auth']);
  });

  it('rejects a non-admin before deferred parsing', async () => {
    const response = await fetch(`${baseUrl}/api/admin/shop/items/7`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-role': 'USER'
      },
      body: `{${largeStyle}`
    });

    expect(response.status).toBe(403);
    expect(mocks.order).toEqual(['auth', 'admin']);
  });

  it('parses large JSON only after admin authorization on create', async () => {
    const response = await fetch(`${baseUrl}/api/admin/shop/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-role': 'ADMIN'
      },
      body: largeJsonBody
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ styleLength: largeStyle.length });
    expect(mocks.order).toEqual(['auth', 'admin', 'controller:create']);
  });

  it('parses large urlencoded data only after admin authorization on numeric update', async () => {
    const response = await fetch(`${baseUrl}/api/admin/shop/items/7`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-test-role': 'ADMIN'
      },
      body: new URLSearchParams({ style_json: largeStyle }).toString()
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ styleLength: largeStyle.length });
    expect(mocks.order).toEqual(['auth', 'admin', 'controller:update']);
  });

  it.each([
    '/api/admin/shop/items/7/reset-purchases',
    '/api/admin/shop/items/not-a-number',
    '/api/shop/buy'
  ])('keeps the default body limit for %s', async (pathname) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-role': 'ADMIN'
      },
      body: largeJsonBody
    });

    expect(response.status).toBe(413);
    expect(mocks.order).toEqual([]);
  });
});
