import { Request, Response } from 'express';
import { IS_PRODUCTION, isConfiguredCorsOriginAllowed, normalizeOrigin } from '../config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Agent } from 'undici';
import { ensureDirectory, getUploadsDir } from '../services/storagePaths';
import {
  createPinnedLookup,
  OutboundNetworkSafetyError,
  validateSafeOutboundUrl
} from '../utils/outboundNetworkSafety';
import {
  MinigameImagePayload,
  MinigameImageTokenError,
  openMinigameImageToken
} from '../services/minigameImageToken';
import { minigameRepository } from '../repositories';

/**
 * 이미지 프록시 — 치지직 CDN/외부 이미지를 동일 출처(+CORS 허용)로 우회 제공.
 * 프로필 카드 이미지 캡처(html-to-image) 시 캔버스 오염(taint) 및 표시 깨짐 방지 목적.
 *
 * 보안: SSRF 방지를 위해 허용된 호스트 화이트리스트만 프록시합니다.
 */

// 허용 호스트 접미사(서브도메인 포함). 치지직/네이버 CDN, dicebear, 자체 업로드 도메인 등.
const ALLOWED_HOST_SUFFIXES = [
  'pstatic.net',
  'naver.net',
  'navercorp.com',
  'nave.rs',
  'dicebear.com',
  'chzzk.naver.com',
  'googleusercontent.com',
  'discordapp.com',
  'discordapp.net',
  'discord.com'
];

const UPLOADS_DIR = getUploadsDir();
ensureDirectory(UPLOADS_DIR);

interface ProxyCacheEntry {
  body: Buffer;
  contentType: string;
  expiresAt: number;
  size: number;
}

interface ProxyTransform {
  width: number | null;
  quality: number;
  minigame: Pick<MinigameImagePayload, 'kind' | 'crop'> | null;
  minigameCacheKey: string | null;
}

const IMAGE_PROXY_DEFAULT_MAX_IN_FLIGHT = 32;
const IMAGE_PROXY_HARD_MAX_IN_FLIGHT = 256;
const IMAGE_PROXY_DEFAULT_MAX_TRANSFORMS = 4;
const IMAGE_PROXY_HARD_MAX_TRANSFORMS = 8;
const IMAGE_PROXY_DEFAULT_MAX_INPUT_PIXELS = 16_000_000;
const IMAGE_PROXY_HARD_MAX_INPUT_PIXELS = 24_000_000;
const IMAGE_PROXY_MAX_REDIRECTS = 3;
const IMAGE_PROXY_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MINIGAME_QUIZ_WIDTH = 240;
const MINIGAME_QUIZ_HEIGHT = 384;
const MINIGAME_CROP_CARD_WIDTH = 640;
const MINIGAME_CROP_CARD_HEIGHT = 1_024;
const MINIGAME_CROP_OUTPUT_SIZE = 320;
// Naver profile originals can exceed the proxy's 4 MiB safety ceiling. `w640`
// keeps enough detail for the zoom clue while bounding both network and Sharp
// work; the widely available f240 derivative is a last-resort CDN fallback.
const MINIGAME_CROP_PSTATIC_TYPE = 'w640';
const MINIGAME_CROP_ROUND_TIME_MS = 10_000;
const MINIGAME_CROP_SUBMISSION_GRACE_MS = 2_000;
const MINIGAME_FALLBACK_CACHE_TTL_MS = 60_000;

export const normalizeImageProxyMaxInFlight = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return IMAGE_PROXY_DEFAULT_MAX_IN_FLIGHT;
  return Math.min(parsed, IMAGE_PROXY_HARD_MAX_IN_FLIGHT);
};

export const normalizeImageProxyMaxTransforms = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return IMAGE_PROXY_DEFAULT_MAX_TRANSFORMS;
  return Math.min(parsed, IMAGE_PROXY_HARD_MAX_TRANSFORMS);
};

export const normalizeImageProxyMaxInputPixels = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return IMAGE_PROXY_DEFAULT_MAX_INPUT_PIXELS;
  return Math.min(parsed, IMAGE_PROXY_HARD_MAX_INPUT_PIXELS);
};

type InFlightAdmission<T> = {
  request: Promise<T>;
};

/**
 * Deduplicates work by key while bounding the number of distinct retained jobs.
 * Existing keys are always admitted, even when the unique-key limit is full.
 */
const createImageProxyInFlightLimiter = <T>(maxInFlight: number) => {
  const limit = normalizeImageProxyMaxInFlight(maxInFlight);
  const entries = new Map<string, Promise<T>>();

  return {
    getOrStart(key: string, start: () => Promise<T>): InFlightAdmission<T> | null {
      const existing = entries.get(key);
      if (existing) return { request: existing };
      if (entries.size >= limit) return null;

      let request: Promise<T>;
      try {
        request = Promise.resolve(start());
      } catch (err) {
        request = Promise.reject(err);
      }
      entries.set(key, request);

      const release = () => {
        if (entries.get(key) === request) entries.delete(key);
      };
      void request.then(release, release);
      return { request };
    }
  };
};

const createImageTransformLimiter = (maxActive: number) => {
  const limit = normalizeImageProxyMaxTransforms(maxActive);
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = async (): Promise<() => void> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    };
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      const release = await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    }
  };
};

const readPositiveNumber = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const IMAGE_PROXY_TIMEOUT_MS = readPositiveNumber('IMAGE_PROXY_TIMEOUT_MS', 5_000);
const IMAGE_PROXY_PSTATIC_RESIZE_TIMEOUT_MS = Math.min(
  IMAGE_PROXY_TIMEOUT_MS,
  readPositiveNumber('IMAGE_PROXY_PSTATIC_RESIZE_TIMEOUT_MS', 1_500)
);
const IMAGE_PROXY_CACHE_TTL_MS = readPositiveNumber('IMAGE_PROXY_CACHE_TTL_MS', 24 * 60 * 60_000);
const IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS = readPositiveNumber('IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS', 5 * 60_000);
const IMAGE_PROXY_RETRY_NEGATIVE_CACHE_TTL_MS = Math.min(
  IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS,
  readPositiveNumber('IMAGE_PROXY_RETRY_NEGATIVE_CACHE_TTL_MS', 1_000)
);
export const IMAGE_PROXY_MAX_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_BYTES', 4 * 1024 * 1024);
const IMAGE_PROXY_MAX_CACHE_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_BYTES', 16 * 1024 * 1024);
const IMAGE_PROXY_MAX_CACHE_ENTRIES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_ENTRIES', 150);
const IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES', 512 * 1024);
const IMAGE_PROXY_MAX_RESIZE_WIDTH = readPositiveNumber('IMAGE_PROXY_MAX_RESIZE_WIDTH', 768);
export const IMAGE_PROXY_MAX_IN_FLIGHT = normalizeImageProxyMaxInFlight(process.env.IMAGE_PROXY_MAX_IN_FLIGHT);
export const IMAGE_PROXY_MAX_TRANSFORMS = normalizeImageProxyMaxTransforms(process.env.IMAGE_PROXY_MAX_TRANSFORMS);
export const IMAGE_PROXY_MAX_INPUT_PIXELS = normalizeImageProxyMaxInputPixels(process.env.IMAGE_PROXY_MAX_INPUT_PIXELS);
const PSTATIC_RESIZE_TYPES = (process.env.IMAGE_PROXY_PSTATIC_TYPES || 'f60_60_na,f120_120_na,f240_240_na')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => /^f\d+_\d+_na$/.test(value))
  .map((value) => {
    const [, width, height] = value.match(/^f(\d+)_(\d+)_na$/) || [];
    return { value, size: Math.max(Number(width || 0), Number(height || 0)) };
  })
  .filter((item) => item.size > 0)
  .sort((a, b) => a.size - b.size);

const proxyCache = new Map<string, ProxyCacheEntry>();
const negativeCache = new Map<string, number>();
const inFlight = createImageProxyInFlightLimiter<ProxyCacheEntry>(IMAGE_PROXY_MAX_IN_FLIGHT);
const transformLimiter = createImageTransformLimiter(IMAGE_PROXY_MAX_TRANSFORMS);
let proxyCacheBytes = 0;

const cleanupNegativeCache = () => {
  const now = Date.now();
  for (const [key, expiresAt] of negativeCache) {
    if (expiresAt <= now || negativeCache.size > IMAGE_PROXY_MAX_CACHE_ENTRIES) {
      negativeCache.delete(key);
    }
  }
};

const resolveLocalUploadPath = (pathname: string): string | null => {
  const marker = '/uploads/';
  const idx = pathname.indexOf(marker);
  if (idx < 0) return null;
  const rel = pathname.slice(idx + marker.length);
  const resolvedPath = path.resolve(UPLOADS_DIR, rel);
  const relCheck = path.relative(UPLOADS_DIR, resolvedPath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
  return resolvedPath;
};

const isAllowedHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  // 자체 백엔드 퍼블릭 호스트(업로드 정적 이미지) 허용
  try {
    const selfUrl = process.env.BACKEND_PUBLIC_URL;
    if (selfUrl) {
      const selfHost = new URL(selfUrl).hostname.toLowerCase();
      if (h === selfHost) return true;
    }
  } catch { /* noop */ }
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
};

// WHATWG URL canonicalization removes explicit default ports (80/443), so a
// remaining port is necessarily non-standard for the selected protocol.
const isAllowedImagePort = (url: URL): boolean => url.port === '';

const readQueryNumber = (value: unknown): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseTransform = (req: Request): ProxyTransform => {
  const width = readQueryNumber(req.query.w);
  const quality = readQueryNumber(req.query.q);
  return {
    width: width ? Math.max(16, Math.min(IMAGE_PROXY_MAX_RESIZE_WIDTH, Math.floor(width))) : null,
    quality: quality ? Math.max(45, Math.min(92, Math.floor(quality))) : 78,
    minigame: null,
    minigameCacheKey: null
  };
};

const transformCacheSuffix = (transform: ProxyTransform) =>
  transform.minigameCacheKey
    ? `|mg=${transform.minigameCacheKey}`
    : transform.width ? `|w=${transform.width}|q=${transform.quality}` : '|original';

const isPstaticImageHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return h === 'pstatic.net' || h.endsWith('.pstatic.net');
};

const pickPstaticResizeType = (width: number): string | null => {
  const targetWidth = Math.max(1, width);
  if (targetWidth <= 480) {
    return PSTATIC_RESIZE_TYPES.find((candidate) => candidate.size === 240)?.value
      || PSTATIC_RESIZE_TYPES[PSTATIC_RESIZE_TYPES.length - 1]?.value
      || null;
  }
  return null;
};

const getPstaticResizeTypeSize = (value: string | null): number | null => {
  const [, width, height] = value?.match(/^f(\d+)_(\d+)_na$/) || [];
  if (!width || !height) return null;
  return Math.max(Number(width), Number(height));
};

const getUpstreamImageUrl = (target: URL, transform: ProxyTransform): URL => {
  const upstream = new URL(target.toString());
  if (transform.width && isPstaticImageHost(upstream.hostname)) {
    if (transform.minigame?.kind === 'crop') {
      upstream.searchParams.set('type', MINIGAME_CROP_PSTATIC_TYPE);
      return upstream;
    }
    const resizeType = pickPstaticResizeType(transform.width);
    if (resizeType) {
      upstream.searchParams.set('type', resizeType);
    } else {
      const existingResizeSize = getPstaticResizeTypeSize(upstream.searchParams.get('type'));
      if (existingResizeSize !== null && existingResizeSize < transform.width) {
        upstream.searchParams.delete('type');
      }
    }
  }
  return upstream;
};

const getMinigameCropPstaticFallbackUrl = (target: URL): URL | null => {
  if (!isPstaticImageHost(target.hostname)) return null;
  const resizeType = pickPstaticResizeType(480);
  if (!resizeType) return null;
  const fallback = new URL(target.toString());
  fallback.searchParams.set('type', resizeType);
  return fallback;
};

const getLocalContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
};

const getLocalFileStat = (filePath: string): fs.Stats | null => {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
};

const getCachedProxyImage = (key: string): ProxyCacheEntry | null => {
  const cached = proxyCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    proxyCache.delete(key);
    proxyCacheBytes -= cached.size;
    return null;
  }
  proxyCache.delete(key);
  proxyCache.set(key, cached);
  return cached;
};

const setCachedProxyImage = (key: string, entry: ProxyCacheEntry) => {
  if (entry.size > IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES) return;
  const prev = proxyCache.get(key);
  if (prev) proxyCacheBytes -= prev.size;
  proxyCache.set(key, entry);
  proxyCacheBytes += entry.size;

  while (
    proxyCache.size > IMAGE_PROXY_MAX_CACHE_ENTRIES ||
    proxyCacheBytes > IMAGE_PROXY_MAX_CACHE_BYTES
  ) {
    const oldestKey = proxyCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = proxyCache.get(oldestKey);
    if (oldest) proxyCacheBytes -= oldest.size;
    proxyCache.delete(oldestKey);
  }
};

type ProxyResponsePolicy = 'generic' | 'minigame';

const sendProxyImage = (
  res: Response,
  entry: ProxyCacheEntry,
  cacheStatus: 'HIT' | 'MISS',
  policy: ProxyResponsePolicy = 'generic'
) => {
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Content-Length', String(entry.body.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (policy === 'minigame') {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  res.setHeader('X-Image-Proxy-Cache', cacheStatus);
  return res.status(200).send(entry.body);
};

const enableCredentialedMinigameImageCors = (req: Request, res: Response) => {
  const rawOrigin = Array.isArray(req.headers?.origin) ? req.headers.origin[0] : req.headers?.origin;
  const origin = normalizeOrigin(rawOrigin);
  if (!origin || !isConfiguredCorsOriginAllowed(origin)) return;

  // The standalone image worker installs generic `cors('*')` for public image
  // proxy traffic. Overwrite it here because credentialed browser fetches need
  // the exact allow-listed origin rather than a wildcard.
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Minigame-Image-Fallback, X-Minigame-Round-Deadline, X-Minigame-Server-Now'
  );
  const existingVary = String(res.getHeader('Vary') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!existingVary.some((value) => value.toLowerCase() === 'origin')) existingVary.push('Origin');
  res.setHeader('Vary', existingVary.join(', '));
};

const sendImageProxyOverloaded = (res: Response) => {
  res.setHeader('Retry-After', '1');
  return res.status(503).json({
    error: 'ServiceUnavailable',
    message: '이미지 프록시가 현재 처리 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'
  });
};

const readBodyWithLimit = async (upstream: globalThis.Response): Promise<Buffer> => {
  if (!upstream.body) {
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.byteLength > IMAGE_PROXY_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
    return body;
  }

  const reader = (upstream.body as any).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > IMAGE_PROXY_MAX_BYTES) {
        await reader.cancel();
        throw new Error('IMAGE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
};

type RasterSignature = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'bmp';

const detectRasterSignature = (body: Buffer): RasterSignature | null => {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpeg';
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (body.length >= 6) {
    const gif = body.subarray(0, 6).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  }
  if (body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (body.length >= 12 && body.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = body.subarray(8, 12).toString('ascii');
    if (['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'avif';
  }
  if (body.length >= 2 && body[0] === 0x42 && body[1] === 0x4d) return 'bmp';
  return null;
};

const isActiveImageDocument = (body: Buffer): boolean => {
  const prefix = body.subarray(0, Math.min(body.length, 512))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  return prefix.startsWith('<svg') ||
    prefix.startsWith('<?xml') ||
    prefix.startsWith('<!doctype') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<script');
};

const throwUnsupportedProxyImage = (): never => {
  const error = new Error('NOT_IMAGE') as Error & { statusCode?: number };
  error.statusCode = 415;
  throw error;
};

const sanitizeAndResizeImageForProxy = async (
  body: Buffer,
  contentType: string,
  transform: ProxyTransform,
  trustedInternalSvg = false
): Promise<{ body: Buffer; contentType: string }> => {
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!trustedInternalSvg && (
    normalizedContentType.includes('svg') ||
    normalizedContentType.includes('xml') ||
    isActiveImageDocument(body)
  )) {
    throwUnsupportedProxyImage();
  }

  const signature = trustedInternalSvg ? null : detectRasterSignature(body);
  if (!trustedInternalSvg && !signature) throwUnsupportedProxyImage();

  return transformLimiter.run(async () => {
    try {
      let pipeline = sharp(body, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: IMAGE_PROXY_MAX_INPUT_PIXELS
      }).rotate();
      const metadata = await pipeline.metadata();
      const expectedFormats: string[] = signature === 'avif' ? ['avif', 'heif'] : [signature as RasterSignature];
      if (
        !metadata.format ||
        (!trustedInternalSvg && !expectedFormats.includes(metadata.format)) ||
        (trustedInternalSvg && metadata.format !== 'svg')
      ) throwUnsupportedProxyImage();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > IMAGE_PROXY_MAX_INPUT_PIXELS) {
        throwUnsupportedProxyImage();
      }

      let sanitized: Buffer;
      if (transform.minigame?.kind === 'quiz') {
        // The paid quiz must never send recoverable full-resolution pixels to the
        // browser. A small cover render, fixed Gaussian blur, and lossy WebP pass
        // leave the clue playable while making the transform irreversible.
        sanitized = await pipeline
          .resize({ width: MINIGAME_QUIZ_WIDTH, height: MINIGAME_QUIZ_HEIGHT, fit: 'cover' })
          .blur(4)
          .webp({ quality: 70, effort: 3 })
          .toBuffer();
      } else if (transform.minigame?.kind === 'crop' && transform.minigame.crop) {
        const crop = transform.minigame.crop;
        const radians = (crop.rotation * Math.PI) / 180;
        const cropSide = Math.max(16, Math.round(crop.size * MINIGAME_CROP_CARD_WIDTH));
        const rotatedExtent = Math.min(
          MINIGAME_CROP_CARD_WIDTH,
          Math.ceil(cropSide * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))) + 4
        );
        const centerX = crop.x * MINIGAME_CROP_CARD_WIDTH;
        const centerY = crop.y * MINIGAME_CROP_CARD_HEIGHT;
        const left = Math.max(0, Math.min(
          MINIGAME_CROP_CARD_WIDTH - rotatedExtent,
          Math.round(centerX - rotatedExtent / 2)
        ));
        const top = Math.max(0, Math.min(
          MINIGAME_CROP_CARD_HEIGHT - rotatedExtent,
          Math.round(centerY - rotatedExtent / 2)
        ));

        // Render the source into the exact 5:8 card viewport first. Only the
        // bounded region needed for the rotated square survives the first pass;
        // the full card is never encoded into an HTTP response.
        const rotated = await pipeline
          .resize({
            width: MINIGAME_CROP_CARD_WIDTH,
            height: MINIGAME_CROP_CARD_HEIGHT,
            fit: 'cover'
          })
          .extract({ left, top, width: rotatedExtent, height: rotatedExtent })
          .rotate(crop.rotation, { background: { r: 9, g: 9, b: 11, alpha: 1 } })
          .toBuffer({ resolveWithObject: true });
        const finalSide = Math.min(cropSide, rotated.info.width, rotated.info.height);
        sanitized = await sharp(rotated.data, {
          animated: false,
          failOn: 'warning',
          limitInputPixels: IMAGE_PROXY_MAX_INPUT_PIXELS
        })
          .extract({
            left: Math.max(0, Math.floor((rotated.info.width - finalSide) / 2)),
            top: Math.max(0, Math.floor((rotated.info.height - finalSide) / 2)),
            width: finalSide,
            height: finalSide
          })
          .resize({ width: MINIGAME_CROP_OUTPUT_SIZE, height: MINIGAME_CROP_OUTPUT_SIZE, fit: 'fill' })
          .webp({ quality: 82, effort: 3 })
          .toBuffer();
      } else {
        if (transform.width) {
          pipeline = pipeline.resize({ width: transform.width, withoutEnlargement: true });
        }
        sanitized = await pipeline
          .webp({ quality: transform.width ? transform.quality : 88, effort: 3 })
          .toBuffer();
      }
      if (sanitized.byteLength > IMAGE_PROXY_MAX_BYTES) {
        const error = new Error('IMAGE_TOO_LARGE') as Error & { statusCode?: number };
        error.statusCode = 413;
        throw error;
      }
      return { body: sanitized, contentType: 'image/webp' };
    } catch (error: any) {
      if (error?.message === 'IMAGE_TOO_LARGE' || error?.message === 'NOT_IMAGE') throw error;
      return throwUnsupportedProxyImage();
    }
  });
};

const sendTransformedLocalImage = async (
  res: Response,
  resolvedPath: string,
  stat: fs.Stats,
  contentType: string,
  transform: ProxyTransform,
  responsePolicy: ProxyResponsePolicy = 'generic'
) => {
  if (stat.size > IMAGE_PROXY_MAX_BYTES) {
    return res.status(413).json({
      error: 'PayloadTooLarge',
      message: '로컬 이미지가 프록시 변환 허용 크기를 초과했습니다.'
    });
  }

  const normalizedPath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  const cacheKey = `local:${normalizedPath}|mtime=${stat.mtimeMs}|bytes=${stat.size}${transformCacheSuffix(transform)}`;
  const cached = getCachedProxyImage(cacheKey);
  if (cached) return sendProxyImage(res, cached, 'HIT', responsePolicy);

  const admission = inFlight.getOrStart(cacheKey, async () => {
    const rawBody = await fs.promises.readFile(resolvedPath);
    if (rawBody.byteLength > IMAGE_PROXY_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
    const transformed = await sanitizeAndResizeImageForProxy(rawBody, contentType, transform);
    const entry: ProxyCacheEntry = {
      body: transformed.body,
      contentType: transformed.contentType,
      expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
      size: transformed.body.length
    };
    setCachedProxyImage(cacheKey, entry);
    return entry;
  });
  if (!admission) return sendImageProxyOverloaded(res);

  try {
    return sendProxyImage(res, await admission.request, 'MISS', responsePolicy);
  } catch (err: any) {
    if (err?.message === 'NOT_IMAGE' || err?.statusCode === 415) {
      return res.status(415).json({
        error: 'UnsupportedMediaType',
        message: '안전한 래스터 이미지 형식만 프록시할 수 있습니다.'
      });
    }
    if (err?.message === 'IMAGE_TOO_LARGE') {
      return res.status(413).json({
        error: 'PayloadTooLarge',
        message: '로컬 이미지가 프록시 변환 허용 크기를 초과했습니다.'
      });
    }
    if (err?.code === 'ENOENT') {
      return res.status(404).json({ error: 'NotFound', message: '파일을 찾을 수 없습니다.' });
    }
    return res.status(500).json({
      error: 'InternalServerError',
      message: '로컬 이미지 프록시 변환 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err?.message
    });
  }
};

const fetchRemoteImageBody = async (
  upstreamUrl: URL,
  timeoutMs: number
): Promise<{ body: Buffer; contentType: string }> => {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = new URL(upstreamUrl.toString());

    for (let redirectCount = 0; ; redirectCount += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || controller.signal.aborted) throw new Error('UPSTREAM_TIMEOUT');

      // Re-run both the strict CDN hostname policy and DNS public-address
      // validation for every redirect hop. Rejecting mixed DNS answers and
      // pinning the validated set into the transport closes the DNS
      // validation/connect rebinding gap.
      const validated = await validateSafeOutboundUrl(currentUrl, {
        allowedProtocols: ['http:', 'https:'],
        allowHostname: isAllowedHost,
        rejectIpLiterals: true,
        maxLength: 4_096,
        dnsTimeoutMs: Math.min(2_000, remainingMs)
      });
      if (!isAllowedImagePort(validated.url)) {
        throw new OutboundNetworkSafetyError('UNSAFE_PORT', 'Non-standard image ports are not allowed');
      }
      if (controller.signal.aborted) throw new Error('UPSTREAM_TIMEOUT');

      const dispatcher = new Agent({
        connect: {
          lookup: createPinnedLookup(validated.url.hostname, validated.addresses)
        }
      });
      try {
        const upstream = await fetch(validated.url.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          dispatcher,
          headers: {
            // 치지직 CDN은 일부 경우 referer/UA 검사를 하므로 기본값 부여
            'User-Agent': 'Mozilla/5.0 (compatible; Chikapo-ImageProxy/1.0)',
            'Accept': 'image/*'
          }
        } as unknown as RequestInit & { dispatcher: Agent });

        if (IMAGE_PROXY_REDIRECT_STATUSES.has(upstream.status)) {
          await upstream.body?.cancel().catch(() => undefined);
          if (redirectCount >= IMAGE_PROXY_MAX_REDIRECTS) {
            throw new Error('UPSTREAM_TOO_MANY_REDIRECTS');
          }
          const location = upstream.headers.get('location');
          if (!location) throw new Error('UPSTREAM_REDIRECT_WITHOUT_LOCATION');
          try {
            currentUrl = new URL(location, validated.url);
          } catch {
            throw new Error('UPSTREAM_INVALID_REDIRECT');
          }
          continue;
        }

        if (!upstream.ok) {
          await upstream.body?.cancel().catch(() => undefined);
          const error = new Error(`UPSTREAM_${upstream.status}`) as Error & { statusCode?: number };
          error.statusCode = upstream.status;
          throw error;
        }

        const contentType = upstream.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          await upstream.body?.cancel().catch(() => undefined);
          const error = new Error('NOT_IMAGE') as Error & { statusCode?: number };
          error.statusCode = 415;
          throw error;
        }

        const contentLength = Number(upstream.headers.get('content-length') || 0);
        if (contentLength > IMAGE_PROXY_MAX_BYTES) {
          await upstream.body?.cancel().catch(() => undefined);
          const error = new Error('IMAGE_TOO_LARGE') as Error & { statusCode?: number };
          error.statusCode = 413;
          throw error;
        }

        return { body: await readBodyWithLimit(upstream), contentType };
      } finally {
        await dispatcher.destroy().catch(() => undefined);
      }
    }
  } finally {
    clearTimeout(timeout);
  }
};

const fetchRemoteImage = async (target: URL, transform: ProxyTransform): Promise<ProxyCacheEntry> => {
  const upstreamUrl = getUpstreamImageUrl(target, transform);
  const targetUrl = target.toString();
  const targetResizeSize = isPstaticImageHost(target.hostname)
    ? getPstaticResizeTypeSize(target.searchParams.get('type'))
    : null;
  const isRecoveringOriginal = Boolean(
    transform.width &&
    targetResizeSize !== null &&
    targetResizeSize < transform.width &&
    upstreamUrl.searchParams.get('type') === null
  );
  let source: { body: Buffer; contentType: string };

  if (upstreamUrl.toString() !== targetUrl) {
    try {
      source = await fetchRemoteImageBody(
        upstreamUrl,
        isRecoveringOriginal ? IMAGE_PROXY_TIMEOUT_MS : IMAGE_PROXY_PSTATIC_RESIZE_TIMEOUT_MS
      );
    } catch {
      const cropFallbackUrl = transform.minigame?.kind === 'crop'
        ? getMinigameCropPstaticFallbackUrl(target)
        : null;
      if (cropFallbackUrl && cropFallbackUrl.toString() !== upstreamUrl.toString()) {
        try {
          source = await fetchRemoteImageBody(cropFallbackUrl, IMAGE_PROXY_PSTATIC_RESIZE_TIMEOUT_MS);
        } catch {
          // Some pstatic images expose neither bounded derivative. The original
          // remains subject to the same strict byte/pixel limits as every proxy input.
          source = await fetchRemoteImageBody(target, IMAGE_PROXY_TIMEOUT_MS);
        }
      } else {
        // Some pstatic images do not expose every `type=f*_na` derivative. The
        // allow-listed original URL is still safe and can be resized locally.
        source = await fetchRemoteImageBody(target, IMAGE_PROXY_TIMEOUT_MS);
      }
    }
  } else {
    source = await fetchRemoteImageBody(upstreamUrl, IMAGE_PROXY_TIMEOUT_MS);
  }

  const transformed = await sanitizeAndResizeImageForProxy(source.body, source.contentType, transform);
  return {
    body: transformed.body,
    contentType: transformed.contentType,
    expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
    size: transformed.body.length
  };
};

const createMinigameTransform = (payload: MinigameImagePayload): ProxyTransform => {
  const identity = JSON.stringify({ kind: payload.kind, crop: payload.crop || null });
  return {
    width: payload.kind === 'quiz' ? MINIGAME_QUIZ_WIDTH : MINIGAME_CROP_CARD_WIDTH,
    quality: payload.kind === 'quiz' ? 70 : 82,
    minigame: { kind: payload.kind, crop: payload.crop },
    minigameCacheKey: crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)
  };
};

type PreparedMinigameCrop = {
  entry: ProxyCacheEntry;
  cacheStatus: 'HIT' | 'MISS';
  deterministicFallback: boolean;
};

const deterministicFallbackInFlight = createImageProxyInFlightLimiter<ProxyCacheEntry>(
  Math.max(2, Math.min(16, IMAGE_PROXY_MAX_IN_FLIGHT))
);

// Kept byte-for-byte equivalent in shape/color rules with the browser's
// createCropDetectiveFallbackDataUrl(). The protected clue receives a crop of
// this artwork while the matching choice displays the complete 5:8 artwork.
const hashCropFallbackSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createDeterministicCropFallbackSvg = (seedValue: string): Buffer => {
  const seed = hashCropFallbackSeed(seedValue || 'chikapo-crop-detective');
  const color = (offset: number) => `hsl(${(seed + offset) % 360} 72% 52%)`;
  const primary = color(0);
  const secondary = color(83);
  const accent = color(191);
  const rotation = seed % 180;
  const circleX = 90 + (seed % 320);
  const circleY = 150 + ((seed >>> 7) % 420);
  const circleRadius = 70 + ((seed >>> 15) % 95);
  const lineOffset = 24 + ((seed >>> 21) % 72);
  const mark = (seed % 997).toString().padStart(3, '0');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="800" viewBox="0 0 500 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient><pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})"><path d="M0 ${lineOffset}H96M${lineOffset} 0V96" stroke="rgba(255,255,255,.16)" stroke-width="12"/></pattern></defs><rect width="500" height="800" fill="url(#g)"/><rect width="500" height="800" fill="url(#p)"/><circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="${accent}" fill-opacity=".78"/><circle cx="${500 - circleX}" cy="${800 - circleY}" r="${Math.round(circleRadius * 0.58)}" fill="none" stroke="rgba(255,255,255,.58)" stroke-width="24"/><path d="M42 690L178 514l104 92 176-244v396H42z" fill="rgba(9,9,11,.34)"/><text x="250" y="746" text-anchor="middle" fill="rgba(255,255,255,.86)" font-family="system-ui,sans-serif" font-size="38" font-weight="800" letter-spacing="8">${mark}</text></svg>`, 'utf8');
};

const prepareDeterministicCropFallback = async (
  payload: MinigameImagePayload,
  transform: ProxyTransform
): Promise<PreparedMinigameCrop> => {
  const fallbackCacheKey = `minigame-crop-fallback:${crypto.createHash('sha256').update(payload.sourceUrl).digest('hex')}${transformCacheSuffix(transform)}`;
  const cached = getCachedProxyImage(fallbackCacheKey);
  if (cached) return { entry: cached, cacheStatus: 'HIT', deterministicFallback: true };

  const admission = deterministicFallbackInFlight.getOrStart(fallbackCacheKey, async () => {
    const rendered = await sanitizeAndResizeImageForProxy(
      createDeterministicCropFallbackSvg(payload.sourceUrl),
      'image/svg+xml',
      transform,
      true
    );
    const entry: ProxyCacheEntry = {
      body: rendered.body,
      contentType: rendered.contentType,
      expiresAt: Date.now() + MINIGAME_FALLBACK_CACHE_TTL_MS,
      size: rendered.body.length
    };
    setCachedProxyImage(fallbackCacheKey, entry);
    return entry;
  });
  if (!admission) throw new Error('MINIGAME_FALLBACK_OVERLOADED');
  return { entry: await admission.request, cacheStatus: 'MISS', deterministicFallback: true };
};

const prepareLocalMinigameCrop = async (
  resolvedPath: string,
  stat: fs.Stats,
  contentType: string,
  transform: ProxyTransform
): Promise<PreparedMinigameCrop> => {
  if (stat.size > IMAGE_PROXY_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const normalizedPath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  const cacheKey = `local:${normalizedPath}|mtime=${stat.mtimeMs}|bytes=${stat.size}${transformCacheSuffix(transform)}`;
  const cached = getCachedProxyImage(cacheKey);
  if (cached) return { entry: cached, cacheStatus: 'HIT', deterministicFallback: false };

  const admission = inFlight.getOrStart(cacheKey, async () => {
    const rawBody = await fs.promises.readFile(resolvedPath);
    if (rawBody.byteLength > IMAGE_PROXY_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
    const transformed = await sanitizeAndResizeImageForProxy(rawBody, contentType, transform);
    const entry: ProxyCacheEntry = {
      body: transformed.body,
      contentType: transformed.contentType,
      expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
      size: transformed.body.length
    };
    setCachedProxyImage(cacheKey, entry);
    return entry;
  });
  if (!admission) throw new Error('IMAGE_PROXY_OVERLOADED');
  return { entry: await admission.request, cacheStatus: 'MISS', deterministicFallback: false };
};

const prepareProtectedCropImage = async (
  payload: MinigameImagePayload,
  transform: ProxyTransform
): Promise<PreparedMinigameCrop> => {
  try {
    const raw = payload.sourceUrl;
    if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
      const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(cleanPath);
      } catch {
        decodedPath = cleanPath;
      }
      const resolvedPath = resolveLocalUploadPath(decodedPath);
      const stat = resolvedPath ? getLocalFileStat(resolvedPath) : null;
      if (!resolvedPath || !stat) throw new Error('LOCAL_IMAGE_NOT_FOUND');
      return await prepareLocalMinigameCrop(resolvedPath, stat, getLocalContentType(resolvedPath), transform);
    }

    const target = new URL(raw);
    const localPath = getSelfHostedUploadPath(target);
    if (localPath) {
      const stat = getLocalFileStat(localPath);
      if (!stat) throw new Error('LOCAL_IMAGE_NOT_FOUND');
      return await prepareLocalMinigameCrop(localPath, stat, getLocalContentType(localPath), transform);
    }
    if (
      (target.protocol !== 'http:' && target.protocol !== 'https:') ||
      !isAllowedHost(target.hostname) ||
      !isAllowedImagePort(target)
    ) throw new Error('UNSAFE_MINIGAME_IMAGE_SOURCE');

    const cacheKey = `${getUpstreamImageUrl(target, transform).toString()}${transformCacheSuffix(transform)}`;
    const cached = getCachedProxyImage(cacheKey);
    if (cached) return { entry: cached, cacheStatus: 'HIT', deterministicFallback: false };
    if ((negativeCache.get(cacheKey) || 0) > Date.now()) {
      return await prepareDeterministicCropFallback(payload, transform);
    }
    negativeCache.delete(cacheKey);

    const admission = inFlight.getOrStart(cacheKey, () => (
      fetchRemoteImage(target, transform)
        .then((entry) => {
          setCachedProxyImage(cacheKey, entry);
          negativeCache.delete(cacheKey);
          return entry;
        })
        .catch((err) => {
          cleanupNegativeCache();
          negativeCache.set(cacheKey, Date.now() + IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS);
          throw err;
        })
    ));
    if (!admission) throw new Error('IMAGE_PROXY_OVERLOADED');
    return { entry: await admission.request, cacheStatus: 'MISS', deterministicFallback: false };
  } catch {
    // The fallback is generated locally from the exact same source-URL seed as
    // the candidate tile, so upstream 4xx/5xx, timeouts, oversized inputs, and
    // worker pressure do not turn a paid round into an unusable screen.
    return prepareDeterministicCropFallback(payload, transform);
  }
};

type CachedCropRoundArm = { deadline: string; expiresAt: number };
const CROP_ROUND_ARM_CACHE_MAX_ENTRIES = 2_048;
const cropRoundArmCache = new Map<string, CachedCropRoundArm>();
const cropRoundArmInFlight = new Map<string, Promise<{ deadline: string; armedNow: boolean } | null>>();

const getCropRoundArmKey = (payload: MinigameImagePayload) =>
  crypto.createHash('sha256')
    .update(`${payload.userId}\u0000${payload.sessionId}\u0000${payload.round}\u0000${payload.sourceUrl}`, 'utf8')
    .digest('hex');

const cacheCropRoundArm = (key: string, deadline: string) => {
  const expiresAt = Date.parse(deadline);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  cropRoundArmCache.delete(key);
  cropRoundArmCache.set(key, { deadline, expiresAt });
  while (cropRoundArmCache.size > CROP_ROUND_ARM_CACHE_MAX_ENTRIES) {
    const oldestKey = cropRoundArmCache.keys().next().value;
    if (!oldestKey) break;
    cropRoundArmCache.delete(oldestKey);
  }
};

const armPreparedCropRound = async (payload: MinigameImagePayload) => {
  const armKey = getCropRoundArmKey(payload);
  const cached = cropRoundArmCache.get(armKey);
  if (cached && cached.expiresAt > Date.now()) {
    cropRoundArmCache.delete(armKey);
    cropRoundArmCache.set(armKey, cached);
    return { deadline: cached.deadline, armedNow: false };
  }
  if (cached) cropRoundArmCache.delete(armKey);

  const existing = cropRoundArmInFlight.get(armKey);
  if (existing) {
    const armed = await existing;
    return armed ? { ...armed, armedNow: false } : null;
  }

  const request = (async () => {
    const proposedDeadline = new Date(
      Date.now() + MINIGAME_CROP_ROUND_TIME_MS + MINIGAME_CROP_SUBMISSION_GRACE_MS
    ).toISOString();
    const result = await minigameRepository.armRoundDeadline(
      payload.sessionId,
      payload.userId,
      payload.round,
      proposedDeadline
    );
    if (!result.ok || !result.session) return null;
    const progress = (() => {
      try {
        return JSON.parse(String(result.session?.progress_data || '{}'));
      } catch {
        return {};
      }
    })();
    const deadline = typeof progress.round_deadline_at === 'string'
      ? progress.round_deadline_at
      : null;
    if (!deadline || !Number.isFinite(new Date(deadline).getTime())) return null;
    const armed = { deadline, armedNow: result.armedNow === true };
    cacheCropRoundArm(armKey, deadline);
    return armed;
  })();
  cropRoundArmInFlight.set(armKey, request);
  try {
    return await request;
  } finally {
    if (cropRoundArmInFlight.get(armKey) === request) cropRoundArmInFlight.delete(armKey);
  }
};

const constantTimeStringEqual = (left: string, right: string): boolean => {
  const leftHash = crypto.createHash('sha256').update(left, 'utf8').digest();
  const rightHash = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
};

const getSelfHostedUploadPath = (target: URL): string | null => {
  let isSelfHost = false;
  try {
    const selfUrl = process.env.BACKEND_PUBLIC_URL;
    if (selfUrl) {
      isSelfHost = target.hostname.toLowerCase() === new URL(selfUrl).hostname.toLowerCase();
    }
  } catch { /* noop */ }
  if (target.hostname.toLowerCase() === 'localhost' || target.hostname.toLowerCase() === '127.0.0.1') {
    isSelfHost = true;
  }
  if (!isSelfHost || !target.pathname.startsWith('/uploads/')) return null;
  try {
    return resolveLocalUploadPath(decodeURIComponent(target.pathname));
  } catch {
    return resolveLocalUploadPath(target.pathname);
  }
};

const sendMinigameProxyFailure = (res: Response, err: any) => {
  if (err?.message === 'NOT_IMAGE' || err?.statusCode === 415) {
    return res.status(415).json({ error: 'UnsupportedMediaType', message: '이미지가 아닌 리소스입니다.' });
  }
  if (err?.message === 'IMAGE_TOO_LARGE' || err?.statusCode === 413) {
    return res.status(413).json({ error: 'PayloadTooLarge', message: '이미지가 프록시 허용 크기를 초과했습니다.' });
  }
  return res.status(502).json({
    error: 'BadGateway',
    message: '미니게임 이미지 처리 중 오류가 발생했습니다.',
    details: IS_PRODUCTION ? undefined : err?.message
  });
};

/**
 * Authenticated paid-minigame image renderer. The caller supplies the user id
 * from verified session claims. Crop clues atomically arm their current round
 * only after a real or deterministic fallback image has been prepared.
 */
export const proxyMinigameImage = async (req: Request, res: Response, userId: string) => {
  enableCredentialedMinigameImageCors(req, res);
  const queryKeys = Object.keys(req.query || {});
  const forceDeterministicFallback = req.query.fallback === 'deterministic';
  const validQueryKeys = queryKeys.every((key) => key === 'mg' || key === 'fallback');
  if (
    !validQueryKeys ||
    !queryKeys.includes('mg') ||
    queryKeys.length > 2 ||
    typeof req.query.mg !== 'string' ||
    (queryKeys.includes('fallback') && !forceDeterministicFallback)
  ) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'mg와 허용된 fallback 파라미터만 사용할 수 있습니다.'
    });
  }

  let payload: MinigameImagePayload;
  try {
    payload = openMinigameImageToken(req.query.mg);
  } catch (error) {
    if (error instanceof MinigameImageTokenError && error.code === 'EXPIRED') {
      return res.status(410).json({ error: 'Gone', message: '미니게임 이미지 참조가 만료되었습니다.' });
    }
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 미니게임 이미지 참조입니다.' });
  }
  if (typeof userId !== 'string' || !constantTimeStringEqual(payload.userId, userId)) {
    return res.status(403).json({ error: 'Forbidden', message: '이 이미지에 접근할 권한이 없습니다.' });
  }
  if (forceDeterministicFallback && payload.kind !== 'crop') {
    return res.status(400).json({ error: 'BadRequest', message: 'fallback 모드는 카드 확대 탐정에서만 사용할 수 있습니다.' });
  }

  const raw = payload.sourceUrl;
  const transform = createMinigameTransform(payload);

  if (payload.kind === 'crop') {
    let prepared: PreparedMinigameCrop;
    try {
      prepared = forceDeterministicFallback
        ? await prepareDeterministicCropFallback(payload, transform)
        : await prepareProtectedCropImage(payload, transform);
    } catch (err: any) {
      return sendMinigameProxyFailure(res, err);
    }

    // Do not start a paid round if the requester disappeared while its clue was
    // being prepared. Once armed, the existing deadline is immutable.
    if (req.destroyed || res.destroyed) return;

    let armed: Awaited<ReturnType<typeof armPreparedCropRound>>;
    try {
      armed = await armPreparedCropRound(payload);
    } catch (err: any) {
      console.warn('[ImageProxy] crop round arm failed:', err?.message || err);
      armed = null;
    }
    if (!armed) {
      res.setHeader('Retry-After', '1');
      return res.status(503).json({
        error: 'MinigameRoundNotReady',
        message: '확대 이미지 라운드를 안전하게 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      });
    }

    res.setHeader('X-Minigame-Round-Deadline', armed.deadline);
    res.setHeader('X-Minigame-Server-Now', new Date().toISOString());
    res.setHeader('X-Minigame-Round-Armed', armed.armedNow ? 'new' : 'existing');
    if (prepared.deterministicFallback) {
      res.setHeader('X-Minigame-Image-Fallback', 'deterministic');
    }
    return sendProxyImage(res, prepared.entry, prepared.cacheStatus, 'minigame');
  }

  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(cleanPath);
    } catch {
      decodedPath = cleanPath;
    }
    const resolvedPath = resolveLocalUploadPath(decodedPath);
    if (!resolvedPath) {
      return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 파일 경로입니다.' });
    }
    const stat = getLocalFileStat(resolvedPath);
    if (!stat) return res.status(404).json({ error: 'NotFound', message: '파일을 찾을 수 없습니다.' });
    return sendTransformedLocalImage(
      res,
      resolvedPath,
      stat,
      getLocalContentType(resolvedPath),
      transform,
      'minigame'
    );
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 이미지 참조입니다.' });
  }

  const localPath = getSelfHostedUploadPath(target);
  if (localPath) {
    const stat = getLocalFileStat(localPath);
    if (!stat) return res.status(404).json({ error: 'NotFound', message: '자체 업로드 파일을 찾을 수 없습니다.' });
    return sendTransformedLocalImage(
      res,
      localPath,
      stat,
      getLocalContentType(localPath),
      transform,
      'minigame'
    );
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 프로토콜입니다.' });
  }
  if (!isAllowedHost(target.hostname) || !isAllowedImagePort(target)) {
    return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 이미지 원본입니다.' });
  }

  const cacheKey = `${getUpstreamImageUrl(target, transform).toString()}${transformCacheSuffix(transform)}`;
  const cached = getCachedProxyImage(cacheKey);
  if (cached) return sendProxyImage(res, cached, 'HIT', 'minigame');

  const failedUntil = negativeCache.get(cacheKey) || 0;
  if (failedUntil > Date.now()) {
    return res.status(502).json({ error: 'BadGateway', message: '원본 이미지가 최근 처리에 실패했습니다.' });
  }
  if (failedUntil) negativeCache.delete(cacheKey);

  const admission = inFlight.getOrStart(cacheKey, () => (
    fetchRemoteImage(target, transform)
      .then((entry) => {
        setCachedProxyImage(cacheKey, entry);
        negativeCache.delete(cacheKey);
        return entry;
      })
      .catch((err) => {
        cleanupNegativeCache();
        negativeCache.set(cacheKey, Date.now() + IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS);
        throw err;
      })
  ));
  if (!admission) return sendImageProxyOverloaded(res);

  try {
    return sendProxyImage(res, await admission.request, 'MISS', 'minigame');
  } catch (err: any) {
    return sendMinigameProxyFailure(res, err);
  }
};

export const proxyImage = async (req: Request, res: Response) => {
  if (req.query.mg !== undefined) {
    return res.status(400).json({
      error: 'BadRequest',
      message: '미니게임 이미지 참조는 전용 경로에서만 사용할 수 있습니다.'
    });
  }
  const raw = String(req.query.url || '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'BadRequest', message: 'url 파라미터가 필요합니다.' });
  }
  const transform = parseTransform(req);
  // A tiny bounded retry variant lets trusted clients escape a short-lived
  // negative cache entry without turning the proxy into an unbounded cache-key fanout.
  const retryVariant = Math.max(0, Math.min(2, Math.floor(readQueryNumber(req.query.retry) || 0)));

  // 1. 상대 경로(/uploads/...)인 경우 로컬 파일 시스템에서 직접 전송 (네트워크 미경유)
  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const cleanPath = raw.startsWith('/') ? raw : '/' + raw;
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(cleanPath);
    } catch {
      decodedPath = cleanPath;
    }

    const resolvedPath = resolveLocalUploadPath(decodedPath);
    if (!resolvedPath) {
      return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 파일 경로입니다.' });
    }

    const stat = getLocalFileStat(resolvedPath);
    if (stat) {
      const contentType = getLocalContentType(resolvedPath);
      return sendTransformedLocalImage(res, resolvedPath, stat, contentType, transform);
    } else {
      return res.status(404).json({ error: 'NotFound', message: '파일을 찾을 수 없습니다.' });
    }
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 URL입니다.' });
  }

  // 2. 자체 서버를 가리키는 절대 경로인 경우 포트 변경 및 호스트 도메인 유연하게 로컬 파일로 우회
  const selfUrl = process.env.BACKEND_PUBLIC_URL;
  let isSelfHost = false;
  try {
    if (selfUrl) {
      const selfHost = new URL(selfUrl).hostname.toLowerCase();
      if (target.hostname.toLowerCase() === selfHost && target.pathname.startsWith('/uploads/')) {
        isSelfHost = true;
      }
    }
  } catch { /* noop */ }
  
  if (target.hostname.toLowerCase() === 'localhost' || target.hostname.toLowerCase() === '127.0.0.1') {
    if (target.pathname.startsWith('/uploads/')) {
      isSelfHost = true;
    }
  }

  if (isSelfHost) {
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(target.pathname);
    } catch {
      decodedPath = target.pathname;
    }

    const resolvedPath = resolveLocalUploadPath(decodedPath);
    const stat = resolvedPath ? getLocalFileStat(resolvedPath) : null;
    if (resolvedPath && stat) {
      const contentType = getLocalContentType(resolvedPath);
      return sendTransformedLocalImage(res, resolvedPath, stat, contentType, transform);
    }
    return res.status(404).json({ error: 'NotFound', message: '자체 업로드 파일을 찾을 수 없습니다.' });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 프로토콜입니다.' });
  }
  if (!isAllowedHost(target.hostname)) {
    return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 이미지 호스트입니다.' });
  }
  if (!isAllowedImagePort(target)) {
    return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 이미지 포트입니다.' });
  }

  const upstreamTarget = getUpstreamImageUrl(target, transform);
  // `retry` is a request policy, not image identity. Keeping the positive cache
  // and in-flight key canonical prevents simultaneous normal/retry requests from
  // duplicating the same upstream download.
  const cacheKey = `${upstreamTarget.toString()}${transformCacheSuffix(transform)}`;
  const cached = getCachedProxyImage(cacheKey);
  if (cached) {
    return sendProxyImage(res, cached, 'HIT');
  }

  const failedUntil = negativeCache.get(cacheKey) || 0;
  if (retryVariant === 0 && failedUntil > Date.now()) {
    return res.status(502).json({ error: 'BadGateway', message: '원본 이미지가 최근 프록시에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (failedUntil && failedUntil <= Date.now()) negativeCache.delete(cacheKey);

  const admission = inFlight.getOrStart(cacheKey, () => (
    fetchRemoteImage(target, transform)
      .then((entry) => {
        setCachedProxyImage(cacheKey, entry);
        negativeCache.delete(cacheKey);
        return entry;
      })
      .catch((err) => {
        cleanupNegativeCache();
        negativeCache.set(
          cacheKey,
          Date.now() + (retryVariant > 0 ? IMAGE_PROXY_RETRY_NEGATIVE_CACHE_TTL_MS : IMAGE_PROXY_NEGATIVE_CACHE_TTL_MS)
        );
        throw err;
      })
  ));
  if (!admission) {
    return sendImageProxyOverloaded(res);
  }
  const { request } = admission;

  try {
    const entry = await request;
    return sendProxyImage(res, entry, 'MISS');
  } catch (err: any) {
    if (err?.message === 'NOT_IMAGE' || err?.statusCode === 415) {
      return res.status(415).json({ error: 'UnsupportedMediaType', message: '이미지가 아닌 리소스입니다.' });
    }
    if (err?.message === 'IMAGE_TOO_LARGE' || err?.statusCode === 413) {
      return res.status(413).json({ error: 'PayloadTooLarge', message: '이미지가 프록시 허용 크기를 초과했습니다.' });
    }
    return res.status(502).json({
      error: 'BadGateway',
      message: '이미지 프록시 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
