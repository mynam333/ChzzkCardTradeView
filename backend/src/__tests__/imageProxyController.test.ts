import { Request, Response } from 'express';
import { promises as dns } from 'node:dns';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories', () => ({
  minigameRepository: {
    armRoundDeadline: vi.fn()
  }
}));

import {
  IMAGE_PROXY_MAX_BYTES,
  IMAGE_PROXY_MAX_IN_FLIGHT,
  IMAGE_PROXY_MAX_INPUT_PIXELS,
  IMAGE_PROXY_MAX_TRANSFORMS,
  normalizeImageProxyMaxInFlight,
  normalizeImageProxyMaxInputPixels,
  normalizeImageProxyMaxTransforms,
  proxyImage,
  proxyMinigameImage
} from '../controllers/imageProxyController';
import {
  createMinigameImageReference,
  MINIGAME_IMAGE_TOKEN_TTL_MS,
  MINIGAME_IMAGE_REFERENCE_PREFIX
} from '../services/minigameImageToken';
import { getUploadsDir } from '../services/storagePaths';
import { minigameRepository } from '../repositories';

const armRoundDeadline = vi.mocked(minigameRepository.armRoundDeadline);

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

const rawImageResponse = (bodyBuffer: Buffer, contentType: string) => {
  const body = Uint8Array.from(bodyBuffer);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        if (name.toLowerCase() === 'content-length') return String(body.byteLength);
        return null;
      }
    },
    body: null,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  } as unknown as globalThis.Response;
};

const imageResponse = (_bytes?: number[]) => rawImageResponse(VALID_PNG, 'image/png');

const crc32 = (input: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngWithDimensions = (width: number, height: number): Buffer => {
  const body = Buffer.from(VALID_PNG);
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  body.writeUInt32BE(crc32(body.subarray(12, 29)), 29);
  return body;
};

const failedResponse = (status = 503) => ({
  ok: false,
  status,
  headers: { get: () => null },
  body: null,
  arrayBuffer: async () => new ArrayBuffer(0)
}) as unknown as globalThis.Response;

const redirectResponse = (location: string, status = 302) => ({
  ok: false,
  status,
  headers: {
    get: (name: string) => name.toLowerCase() === 'location' ? location : null
  },
  body: null,
  arrayBuffer: async () => new ArrayBuffer(0)
}) as unknown as globalThis.Response;

const createRequest = (url: string, query: Record<string, string> = {}) => ({
  query: { url, ...query }
}) as unknown as Request;

const createMinigameRequest = (
  sourceUrl: string,
  kind: 'quiz' | 'crop' = 'quiz',
  overrides: Record<string, string> = {},
  origin?: string,
  crop = { x: 0.5, y: 0.5, size: 0.1, rotation: 15 }
) => {
  const reference = createMinigameImageReference({
    userId: 'user-1',
    sessionId: 'session-1',
    round: 0,
    sourceUrl,
    kind,
    ...(kind === 'crop' ? { crop } : {})
  });
  return {
    headers: origin ? { origin } : {},
    query: {
      mg: reference.slice(MINIGAME_IMAGE_REFERENCE_PREFIX.length),
      ...overrides
    }
  } as unknown as Request;
};

const createResponse = () => {
  const headers = new Map<string, string>();
  const response: any = {
    statusCode: 200,
    body: undefined,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), String(value));
      return response;
    }),
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    send: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    getHeader: (name: string) => headers.get(name.toLowerCase())
  };
  return response as Response & {
    statusCode: number;
    body: unknown;
    getHeader(name: string): string | undefined;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(dns, 'lookup').mockResolvedValue([
    { address: '93.184.216.34', family: 4 }
  ] as any);
  armRoundDeadline.mockImplementation(async (
    sessionId,
    userId,
    _round,
    roundDeadlineAt
  ) => ({
    ok: true,
    armedNow: true,
    session: {
      id: sessionId,
      user_id: userId,
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: '{}',
      progress_data: JSON.stringify({ round_outcomes: [], round_deadline_at: roundDeadlineAt })
    }
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('protected minigame image proxy', () => {
  it('serves only a small blurred quiz WebP under private no-store response policy', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-quiz-protected';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl), response, 'user-1');

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(sourceUrl);
    expect(response.getHeader('Content-Type')).toBe('image/webp');
    expect(response.getHeader('Cache-Control')).toBe('private, no-store');
    expect(response.getHeader('Cross-Origin-Resource-Policy')).toBe('same-site');
    expect(response.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
    const metadata = await sharp(response.body as Buffer).metadata();
    expect(metadata).toMatchObject({ width: 240, height: 384, format: 'webp' });
  });

  it('renders a crop token as a square clue instead of returning the full card', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-protected';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(imageResponse()));
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(200);
    expect(armRoundDeadline).toHaveBeenCalledWith(
      'session-1',
      'user-1',
      0,
      expect.any(String)
    );
    expect(response.getHeader('X-Minigame-Round-Armed')).toBe('new');
    expect(Date.parse(String(response.getHeader('X-Minigame-Round-Deadline') || ''))).toBeGreaterThan(Date.now());
    const metadata = await sharp(response.body as Buffer).metadata();
    expect(metadata).toMatchObject({ width: 320, height: 320, format: 'webp' });
  });

  it.each([
    ['fully transparent', { r: 0, g: 0, b: 0, alpha: 0 }],
    ['visually uniform', { r: 255, g: 255, b: 255, alpha: 1 }]
  ])('returns the third real crop when a %s source has no visually useful region', async (_label, background) => {
    const sourceUrl = `https://api.dicebear.com/9.x/shapes/png?seed=minigame-empty-${_label}`;
    const emptySource = await sharp({
      create: {
        width: 500,
        height: 800,
        channels: 4,
        background
      }
    }).png().toBuffer();
    const fetchMock = vi.fn().mockResolvedValueOnce(rawImageResponse(emptySource, 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(
        sourceUrl,
        'crop',
        {},
        undefined,
        { x: 0.15, y: 0.15, size: 0.08, rotation: 0 }
      ),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.getHeader('X-Minigame-Image-Fallback')).toBeUndefined();
    expect(armRoundDeadline).toHaveBeenCalledTimes(1);
    const stats = await sharp(response.body as Buffer).stats();
    if (background.alpha === 0) expect(stats.channels[3]?.mean || 0).toBeLessThan(1);
    else expect(stats.entropy).toBeLessThan(0.02);
  });

  it('uses the third crop when attempts one and two are empty and attempt three is useful', async () => {
    const width = 640;
    const height = 1_024;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 600; y < 710; y += 1) {
      for (let x = 265; x < 375; x += 1) {
        const offset = (y * width + x) * 4;
        const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        pixels[offset] = light ? 245 : 20;
        pixels[offset + 1] = light ? 45 : 220;
        pixels[offset + 2] = light ? 190 : 35;
        pixels[offset + 3] = 255;
      }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const fetchMock = vi.fn().mockResolvedValueOnce(rawImageResponse(source, 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(
        'https://api.dicebear.com/9.x/shapes/png?seed=minigame-third-attempt',
        'crop',
        {},
        undefined,
        { x: 0.15, y: 0.15, size: 0.08, rotation: 0 }
      ),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.getHeader('X-Minigame-Image-Fallback')).toBeUndefined();
    expect(armRoundDeadline).toHaveBeenCalledTimes(1);
    const stats = await sharp(response.body as Buffer).stats();
    expect(stats.entropy).toBeGreaterThan(0.5);
  });

  it('returns the third real crop when all three visual checks fail', async () => {
    const width = 640;
    const height = 1_024;
    const pixels = Buffer.alloc(width * height * 3);
    const paintSquare = (centerX: number, centerY: number, color: [number, number, number]) => {
      for (let y = centerY - 50; y < centerY + 50; y += 1) {
        for (let x = centerX - 50; x < centerX + 50; x += 1) {
          const offset = (y * width + x) * 3;
          pixels[offset] = color[0];
          pixels[offset + 1] = color[1];
          pixels[offset + 2] = color[2];
        }
      }
    };
    paintSquare(Math.round(width * 0.15), Math.round(height * 0.15), [245, 15, 10]);
    paintSquare(Math.round(width * 0.5), Math.round(height * 0.36), [10, 245, 15]);
    paintSquare(Math.round(width * 0.5), Math.round(height * 0.64), [15, 10, 245]);
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const fetchMock = vi.fn().mockResolvedValueOnce(rawImageResponse(source, 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(
        'https://api.dicebear.com/9.x/shapes/png?seed=minigame-third-real-crop',
        'crop',
        {},
        undefined,
        { x: 0.15, y: 0.15, size: 0.08, rotation: 0 }
      ),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(armRoundDeadline).toHaveBeenCalledTimes(1);
    expect(response.getHeader('X-Minigame-Image-Fallback')).toBeUndefined();
    const stats = await sharp(response.body as Buffer).stats();
    expect(stats.channels[0].mean).toBeLessThan(30);
    expect(stats.channels[1].mean).toBeLessThan(30);
    expect(stats.channels[2].mean).toBeGreaterThan(220);
    expect(stats.entropy).toBeLessThan(0.05);
  });

  it('applies crop rotation after extracting the normalized source region', async () => {
    const width = 500;
    const height = 800;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        const redSide = x < width / 2;
        pixels[offset] = redSide ? 245 : 10;
        pixels[offset + 1] = 20;
        pixels[offset + 2] = redSide ? 10 : 245;
      }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rawImageResponse(source, 'image/png')));
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(
        'https://api.dicebear.com/9.x/shapes/png?seed=minigame-rotation-order',
        'crop',
        {},
        undefined,
        { x: 0.5, y: 0.5, size: 0.4, rotation: 90 }
      ),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(200);
    expect(response.getHeader('X-Minigame-Image-Fallback')).toBeUndefined();
    const rendered = await sharp(response.body as Buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const halfMean = (axis: 'x' | 'y', upperHalf: boolean, channel: number) => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < rendered.info.height; y += 1) {
        for (let x = 0; x < rendered.info.width; x += 1) {
          const inHalf = axis === 'x'
            ? (upperHalf ? x < rendered.info.width / 2 : x >= rendered.info.width / 2)
            : (upperHalf ? y < rendered.info.height / 2 : y >= rendered.info.height / 2);
          if (!inHalf) continue;
          sum += rendered.data[(y * rendered.info.width + x) * rendered.info.channels + channel];
          count += 1;
        }
      }
      return sum / Math.max(1, count);
    };
    const horizontalRedDifference = Math.abs(halfMean('x', true, 0) - halfMean('x', false, 0));
    const verticalRedDifference = Math.abs(halfMean('y', true, 0) - halfMean('y', false, 0));
    expect(horizontalRedDifference).toBeLessThan(30);
    expect(verticalRedDifference).toBeGreaterThan(150);
  });

  it('returns 502 without arming the round when the source fetch fails', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-offline';
    const fetchMock = vi.fn().mockResolvedValueOnce(failedResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(sourceUrl, 'crop', {}, 'http://localhost:3000'),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(armRoundDeadline).not.toHaveBeenCalled();
    expect(response.getHeader('X-Minigame-Image-Fallback')).toBeUndefined();
    expect(response.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.getHeader('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.getHeader('Access-Control-Expose-Headers')).toBe(
      'X-Minigame-Round-Deadline, X-Minigame-Server-Now'
    );
    expect(response.getHeader('Vary')).toBe('Origin');
    expect(response.body).toMatchObject({ error: 'BadGateway' });
  });

  it('returns 502 without arming the round when source image decoding fails', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-invalid-bytes';
    const invalidPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not-a-decodable-png')
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(rawImageResponse(invalidPng, 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(armRoundDeadline).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ error: 'BadGateway' });
  });

  it('keeps only a short negative-cache window so a paid-round image can be retried', async () => {
    let now = new Date('2030-07-01T03:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-short-negative-cache';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(503))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const firstResponse = createResponse();
    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), firstResponse, 'user-1');
    expect(firstResponse.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const blockedResponse = createResponse();
    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), blockedResponse, 'user-1');
    expect(blockedResponse.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1_001;
    const retryResponse = createResponse();
    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), retryResponse, 'user-1');

    expect(retryResponse.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(armRoundDeadline).toHaveBeenCalledTimes(1);
  });

  it('rejects the removed synthetic fallback query without contacting the source', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-no-synthetic-fallback';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(sourceUrl, 'crop', { fallback: 'deterministic' }),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(armRoundDeadline).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ error: 'BadRequest' });
  });

  it('contains no generated crop fallback implementation or response contract', () => {
    const controllerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/controllers/imageProxyController.ts'),
      'utf8'
    );
    expect(controllerSource).not.toContain('createDeterministicCropFallbackSvg');
    expect(controllerSource).not.toContain('prepareDeterministicCropFallback');
    expect(controllerSource).not.toContain('X-Minigame-Image-Fallback');
    expect(controllerSource).not.toContain("req.query.fallback");
    expect(controllerSource.toLowerCase()).not.toContain('deterministic');
  });

  it('reuses the immutable armed deadline without another database transaction', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-arm-cache';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const firstResponse = createResponse();
    const secondResponse = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), firstResponse, 'user-1');
    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), secondResponse, 'user-1');

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(armRoundDeadline).toHaveBeenCalledTimes(1);
    expect(secondResponse.getHeader('X-Minigame-Round-Armed')).toBe('existing');
    expect(secondResponse.getHeader('X-Minigame-Round-Deadline')).toBe(
      firstResponse.getHeader('X-Minigame-Round-Deadline')
    );
  });

  it('never enables credentialed protected-image CORS for an unconfigured origin', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-cors-denied';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(imageResponse()));
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(sourceUrl, 'crop', {}, 'https://attacker.invalid'),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(200);
    expect(response.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
    expect(response.getHeader('Access-Control-Allow-Credentials')).toBeUndefined();
    expect(response.getHeader('Access-Control-Expose-Headers')).toBeUndefined();
  });

  it('does not disclose prepared crop bytes when the authoritative deadline cannot be armed', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-crop-arm-rejected';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    armRoundDeadline.mockResolvedValueOnce({
      ok: false,
      reason: '현재 순서의 라운드만 준비할 수 있습니다.'
    });
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.send).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ error: 'MinigameRoundNotReady' });
  });

  it('uses a bounded pstatic derivative for crop clues instead of a multi-megabyte original', async () => {
    const sourceUrl = 'https://nng-phinf.pstatic.net/MjAyNjA4MDJfMTIz/profile.png?type=f240_240_na';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.hostname).toBe('nng-phinf.pstatic.net');
    expect(requestedUrl.searchParams.get('type')).toBe('w640');
    expect(requestedUrl.toString()).not.toBe(sourceUrl);
    const metadata = await sharp(response.body as Buffer).metadata();
    expect(metadata).toMatchObject({ width: 320, height: 320, format: 'webp' });
  });

  it('falls back to the small pstatic derivative without fetching the original', async () => {
    const sourceUrl = 'https://nng-phinf.pstatic.net/MjAyNjA4MDJfNDU2/profile.png';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(404))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedUrls = fetchMock.mock.calls.map((call) => new URL(String(call[0])));
    expect(requestedUrls.map((url) => url.searchParams.get('type'))).toEqual([
      'w640',
      'f240_240_na'
    ]);
    expect(requestedUrls.every((url) => url.toString() !== sourceUrl)).toBe(true);
  });

  it('never requests the same pstatic fallback URL twice when every derivative fails', async () => {
    const sourceUrl = 'https://nng-phinf.pstatic.net/MjAyNjA4MDJfNzg5/profile.png?type=f240_240_na';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(404))
      .mockResolvedValueOnce(failedResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl, 'crop'), response, 'user-1');

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedUrls = fetchMock.mock.calls.map((call) => new URL(String(call[0])));
    expect(requestedUrls.map((url) => url.searchParams.get('type'))).toEqual([
      'w640',
      'f240_240_na'
    ]);
    expect(new Set(requestedUrls.map((url) => url.toString())).size).toBe(2);
    expect(armRoundDeadline).not.toHaveBeenCalled();
  });

  it('rejects a different authenticated user before fetching the hidden source', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest('https://api.dicebear.com/9.x/shapes/png?seed=minigame-owner'),
      response,
      'user-2'
    );

    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 410 for an expired image reference without touching the source', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T01:00:00.000Z'));
    const request = createMinigameRequest(
      'https://api.dicebear.com/9.x/shapes/png?seed=minigame-expired'
    );
    vi.setSystemTime(new Date(vi.getMockedSystemTime()!.getTime() + MINIGAME_IMAGE_TOKEN_TTL_MS + 1));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(request, response, 'user-1');

    expect(response.statusCode).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares bounded processed-image cache work across freshly issued equivalent references', async () => {
    const sourceUrl = 'https://api.dicebear.com/9.x/shapes/png?seed=minigame-canonical-cache';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const firstResponse = createResponse();
    const secondResponse = createResponse();

    await proxyMinigameImage(createMinigameRequest(sourceUrl), firstResponse, 'user-1');
    await proxyMinigameImage(createMinigameRequest(sourceUrl), secondResponse, 'user-1');

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.getHeader('X-Image-Proxy-Cache')).toBe('HIT');
    expect(secondResponse.getHeader('Cache-Control')).toBe('private, no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects URL and transform overrides instead of applying them to a valid token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyMinigameImage(
      createMinigameRequest(
        'https://api.dicebear.com/9.x/shapes/png?seed=minigame-no-override',
        'quiz',
        { url: 'https://api.dicebear.com/9.x/shapes/png?seed=attacker', w: '768', retry: '2' }
      ),
      response,
      'user-1'
    );

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps encrypted minigame references out of the public generic proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = createResponse();

    await proxyImage(createRequest(
      'https://api.dicebear.com/9.x/shapes/png?seed=generic-source',
      { mg: 'not-a-public-proxy-token' }
    ), response);

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('image proxy retry cache contract', () => {
  it('deduplicates simultaneous canonical and retry requests through one upstream fetch', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-mixed-retry';
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return imageResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const canonicalResponse = createResponse();
    const retryResponse = createResponse();
    const canonicalRequest = proxyImage(createRequest(url), canonicalResponse);
    const retryRequest = proxyImage(createRequest(url, { retry: '1' }), retryResponse);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    releaseFetch();
    await Promise.all([canonicalRequest, retryRequest]);

    expect(canonicalResponse.statusCode).toBe(200);
    expect(retryResponse.statusCode).toBe(200);
    expect(canonicalResponse.getHeader('Content-Type')).toBe('image/webp');
    expect(canonicalResponse.getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets retry bypass a canonical negative cache and publishes success to the canonical cache', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-negative-recovery';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse())
      .mockResolvedValueOnce(imageResponse([1, 2, 3, 4]));
    vi.stubGlobal('fetch', fetchMock);

    const initialFailure = createResponse();
    await proxyImage(createRequest(url), initialFailure);
    expect(initialFailure.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cachedFailure = createResponse();
    await proxyImage(createRequest(url), cachedFailure);
    expect(cachedFailure.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retrySuccess = createResponse();
    await proxyImage(createRequest(url, { retry: '1' }), retrySuccess);
    expect(retrySuccess.statusCode).toBe(200);
    expect(retrySuccess.getHeader('X-Image-Proxy-Cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const canonicalHit = createResponse();
    await proxyImage(createRequest(url), canonicalHit);
    expect(canonicalHit.statusCode).toBe(200);
    expect(canonicalHit.getHeader('X-Image-Proxy-Cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the allow-listed pstatic original when its resize derivative fails', async () => {
    const url = 'https://ssl.pstatic.net/static/chikapo/proxy-fallback.png';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(404))
      .mockResolvedValueOnce(imageResponse([10, 20, 30, 40]));
    vi.stubGlobal('fetch', fetchMock);

    const response = createResponse();
    await proxyImage(createRequest(url, { w: '240', q: '82' }), response);

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('type=f240_240_na');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(url);
  });

  it('recovers the pstatic original before resizing when the supplied derivative is too small', async () => {
    const url = 'https://ssl.pstatic.net/static/chikapo/high-resolution-source.png?type=f240_240_na';
    const fetchMock = vi.fn().mockResolvedValueOnce(imageResponse([50, 60, 70, 80]));
    vi.stubGlobal('fetch', fetchMock);

    const response = createResponse();
    await proxyImage(createRequest(url, { w: '768', q: '92' }), response);

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.has('type')).toBe(false);
  });

  it('does not fetch a redirect from an allow-listed host to loopback', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-redirect-loopback';
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redirectResponse('http://127.0.0.1:3000/private-image')
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = createResponse();
    await proxyImage(createRequest(url), response);

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('rejects non-standard ports initially and on redirect hops', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redirectResponse('https://api.dicebear.com:8443/9.x/shapes/png?seed=proxy-port-redirect')
    );
    vi.stubGlobal('fetch', fetchMock);

    const initialResponse = createResponse();
    await proxyImage(createRequest(
      'https://api.dicebear.com:8443/9.x/shapes/png?seed=proxy-port-initial'
    ), initialResponse);
    expect(initialResponse.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const redirectResponseResult = createResponse();
    await proxyImage(createRequest(
      'https://api.dicebear.com/9.x/shapes/png?seed=proxy-port-hop'
    ), redirectResponseResult);
    expect(redirectResponseResult.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-resolves an allow-listed hostname on each redirect hop and blocks a private answer', async () => {
    const lookupMock = vi.mocked(dns.lookup);
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as any);
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-dns-rebind';
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redirectResponse('https://api.dicebear.com/9.x/shapes/png?seed=proxy-dns-rebind-next')
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = createResponse();
    await proxyImage(createRequest(url), response);

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('rejects SVG active documents from an allow-listed image host', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/svg?seed=proxy-svg-active';
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rawImageResponse(svg, 'image/svg+xml')));

    const response = createResponse();
    await proxyImage(createRequest(url), response);

    expect(response.statusCode).toBe(415);
    expect(response.body).toMatchObject({ error: 'UnsupportedMediaType' });
  });

  it('rejects an SVG body even when the upstream labels it image/jpeg', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-svg-mislabeled';
    const svg = Buffer.from('\uFEFF  <?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rawImageResponse(svg, 'image/jpeg')));

    const response = createResponse();
    await proxyImage(createRequest(url), response);

    expect(response.statusCode).toBe(415);
    expect(response.body).toMatchObject({ error: 'UnsupportedMediaType' });
  });

  it('rejects a raster whose declared dimensions exceed the Sharp pixel budget', async () => {
    const side = Math.floor(Math.sqrt(IMAGE_PROXY_MAX_INPUT_PIXELS)) + 1;
    const oversizedDimensions = pngWithDimensions(side, side);
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-pixel-budget';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      rawImageResponse(oversizedDimensions, 'image/png')
    ));

    const response = createResponse();
    await proxyImage(createRequest(url), response);

    expect(response.statusCode).toBe(415);
    expect(response.body).toMatchObject({ error: 'UnsupportedMediaType' });
  });
});

describe('image proxy in-flight admission', () => {
  it('validates the configured distinct-key limit against hard bounds', () => {
    expect(normalizeImageProxyMaxInFlight(undefined)).toBe(32);
    expect(normalizeImageProxyMaxInFlight(0)).toBe(32);
    expect(normalizeImageProxyMaxInFlight(12.5)).toBe(32);
    expect(normalizeImageProxyMaxInFlight(12)).toBe(12);
    expect(normalizeImageProxyMaxInFlight(10_000)).toBe(256);
    expect(normalizeImageProxyMaxTransforms(undefined)).toBe(4);
    expect(normalizeImageProxyMaxTransforms(10_000)).toBe(8);
    expect(normalizeImageProxyMaxInputPixels(undefined)).toBe(16_000_000);
    expect(normalizeImageProxyMaxInputPixels(100_000_000)).toBe(24_000_000);
    expect(IMAGE_PROXY_MAX_TRANSFORMS).toBeGreaterThan(0);
    expect(IMAGE_PROXY_MAX_INPUT_PIXELS).toBeLessThanOrEqual(24_000_000);
  });

  it('rejects a new key at capacity while preserving same-key deduplication', async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return imageResponse([90, 91, 92, 93]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const urls = Array.from(
      { length: IMAGE_PROXY_MAX_IN_FLIGHT },
      (_, index) => `https://api.dicebear.com/9.x/shapes/png?seed=proxy-cap-${index}`
    );
    const pending = urls.map((url) => proxyImage(createRequest(url), createResponse()));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT));

    const duplicateResponse = createResponse();
    const duplicate = proxyImage(createRequest(urls[0]), duplicateResponse);
    expect(fetchMock).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT);

    const overloadedResponse = createResponse();
    await proxyImage(
      createRequest('https://api.dicebear.com/9.x/shapes/png?seed=proxy-cap-overflow'),
      overloadedResponse
    );
    expect(overloadedResponse.statusCode).toBe(503);
    expect(overloadedResponse.getHeader('Retry-After')).toBe('1');
    expect(overloadedResponse.body).toMatchObject({ error: 'ServiceUnavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT);

    releaseFetch();
    await Promise.all([...pending, duplicate]);
    expect(duplicateResponse.statusCode).toBe(200);

    const recoveredResponse = createResponse();
    await proxyImage(
      createRequest('https://api.dicebear.com/9.x/shapes/png?seed=proxy-cap-recovered'),
      recoveredResponse
    );
    expect(recoveredResponse.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT + 1);
  });

  it('applies the same admission cap and deduplication to local transforms', async () => {
    const fileName = `proxy-local-cap-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(getUploadsDir(), fileName);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, VALID_PNG);

    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
      await readGate;
      return VALID_PNG;
    });

    try {
      const url = `/uploads/${encodeURIComponent(fileName)}`;
      const pending = Array.from({ length: IMAGE_PROXY_MAX_IN_FLIGHT }, (_, index) => (
        proxyImage(createRequest(url, { w: String(16 + index), q: '78' }), createResponse())
      ));
      expect(readSpy).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT);

      const duplicateResponse = createResponse();
      const duplicate = proxyImage(createRequest(url, { w: '16', q: '78' }), duplicateResponse);
      expect(readSpy).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT);

      const overloadedResponse = createResponse();
      await proxyImage(createRequest(url, { w: '500', q: '78' }), overloadedResponse);
      expect(overloadedResponse.statusCode).toBe(503);
      expect(overloadedResponse.getHeader('Retry-After')).toBe('1');
      expect(readSpy).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT);

      releaseRead();
      await Promise.all([...pending, duplicate]);
      expect(duplicateResponse.statusCode).toBe(200);

      const recoveredResponse = createResponse();
      await proxyImage(createRequest(url, { w: '600', q: '78' }), recoveredResponse);
      expect(recoveredResponse.statusCode).toBe(200);
      expect(readSpy).toHaveBeenCalledTimes(IMAGE_PROXY_MAX_IN_FLIGHT + 1);
    } finally {
      releaseRead();
      await fsp.rm(filePath, { force: true });
    }
  }, 20_000);

  it('rejects an oversized local transform before reading the file into memory', async () => {
    const fileName = `proxy-local-size-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(getUploadsDir(), fileName);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, Buffer.from([0]));
    await fsp.truncate(filePath, IMAGE_PROXY_MAX_BYTES + 1);
    const readSpy = vi.spyOn(fs.promises, 'readFile');

    try {
      const response = createResponse();
      await proxyImage(
        createRequest(`/uploads/${encodeURIComponent(fileName)}`, { w: '240', q: '78' }),
        response
      );
      expect(response.statusCode).toBe(413);
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(filePath, { force: true });
    }
  });

  it('does not serve a local SVG active document through the image proxy', async () => {
    const fileName = `proxy-local-active-${Date.now()}-${Math.random().toString(36).slice(2)}.svg`;
    const filePath = path.join(getUploadsDir(), fileName);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    try {
      const response = createResponse();
      await proxyImage(createRequest(`/uploads/${encodeURIComponent(fileName)}`), response);
      expect(response.statusCode).toBe(415);
      expect(response.body).toMatchObject({ error: 'UnsupportedMediaType' });
    } finally {
      await fsp.rm(filePath, { force: true });
    }
  });
});
