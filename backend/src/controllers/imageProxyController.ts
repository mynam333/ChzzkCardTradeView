import { Request, Response } from 'express';
import { IS_PRODUCTION } from '../config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ensureDirectory, getUploadsDir } from '../services/storagePaths';

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
}

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
const IMAGE_PROXY_MAX_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_BYTES', 4 * 1024 * 1024);
const IMAGE_PROXY_MAX_CACHE_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_BYTES', 16 * 1024 * 1024);
const IMAGE_PROXY_MAX_CACHE_ENTRIES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_ENTRIES', 150);
const IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES = readPositiveNumber('IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES', 512 * 1024);
const IMAGE_PROXY_MAX_RESIZE_WIDTH = readPositiveNumber('IMAGE_PROXY_MAX_RESIZE_WIDTH', 768);
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
const inFlight = new Map<string, Promise<ProxyCacheEntry>>();
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
    quality: quality ? Math.max(45, Math.min(92, Math.floor(quality))) : 78
  };
};

const transformCacheSuffix = (transform: ProxyTransform) =>
  transform.width ? `|w=${transform.width}|q=${transform.quality}` : '|original';

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

const getLocalContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
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

const sendProxyImage = (res: Response, entry: ProxyCacheEntry, cacheStatus: 'HIT' | 'MISS') => {
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Content-Length', String(entry.body.length));
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Image-Proxy-Cache', cacheStatus);
  return res.status(200).send(entry.body);
};

const readBodyWithLimit = async (upstream: globalThis.Response): Promise<Buffer> => {
  if (!upstream.body) {
    return Buffer.from(await upstream.arrayBuffer());
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

const resizeImageForProxy = async (
  body: Buffer,
  contentType: string,
  transform: ProxyTransform
): Promise<{ body: Buffer; contentType: string }> => {
  if (!transform.width) return { body, contentType };

  try {
    const resized = await sharp(body, { animated: false })
      .rotate()
      .resize({ width: transform.width, withoutEnlargement: true })
      .webp({ quality: transform.quality })
      .toBuffer();
    return { body: resized, contentType: 'image/webp' };
  } catch {
    return { body, contentType };
  }
};

const fetchRemoteImageBody = async (
  upstreamUrl: URL,
  timeoutMs: number
): Promise<{ body: Buffer; contentType: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      signal: controller.signal,
      headers: {
        // 치지직 CDN은 일부 경우 referer/UA 검사를 하므로 기본값 부여
        'User-Agent': 'Mozilla/5.0 (compatible; Chikapo-ImageProxy/1.0)',
        'Accept': 'image/*'
      }
    });

    if (!upstream.ok) {
      const error = new Error(`UPSTREAM_${upstream.status}`) as Error & { statusCode?: number };
      error.statusCode = upstream.status;
      throw error;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      const error = new Error('NOT_IMAGE') as Error & { statusCode?: number };
      error.statusCode = 415;
      throw error;
    }

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > IMAGE_PROXY_MAX_BYTES) {
      const error = new Error('IMAGE_TOO_LARGE') as Error & { statusCode?: number };
      error.statusCode = 413;
      throw error;
    }

    return { body: await readBodyWithLimit(upstream), contentType };
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
      // Some pstatic images do not expose every `type=f*_na` derivative. The
      // allow-listed original URL is still safe and can be resized locally.
      source = await fetchRemoteImageBody(target, IMAGE_PROXY_TIMEOUT_MS);
    }
  } else {
    source = await fetchRemoteImageBody(upstreamUrl, IMAGE_PROXY_TIMEOUT_MS);
  }

  const transformed = await resizeImageForProxy(source.body, source.contentType, transform);
  return {
    body: transformed.body,
    contentType: transformed.contentType,
    expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
    size: transformed.body.length
  };
};

export const proxyImage = async (req: Request, res: Response) => {
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

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const contentType = getLocalContentType(resolvedPath);
      if (transform.width) {
        const rawBody = fs.readFileSync(resolvedPath);
        const transformed = await resizeImageForProxy(rawBody, contentType, transform);
        return sendProxyImage(res, {
          body: transformed.body,
          contentType: transformed.contentType,
          expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
          size: transformed.body.length
        }, 'MISS');
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).sendFile(resolvedPath);
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
    if (resolvedPath && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const contentType = getLocalContentType(resolvedPath);
      if (transform.width) {
        const rawBody = fs.readFileSync(resolvedPath);
        const transformed = await resizeImageForProxy(rawBody, contentType, transform);
        return sendProxyImage(res, {
          body: transformed.body,
          contentType: transformed.contentType,
          expiresAt: Date.now() + IMAGE_PROXY_CACHE_TTL_MS,
          size: transformed.body.length
        }, 'MISS');
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).sendFile(resolvedPath);
    }
    return res.status(404).json({ error: 'NotFound', message: '자체 업로드 파일을 찾을 수 없습니다.' });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 프로토콜입니다.' });
  }
  if (!isAllowedHost(target.hostname)) {
    return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 이미지 호스트입니다.' });
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

  let request = inFlight.get(cacheKey);
  if (!request) {
    request = fetchRemoteImage(target, transform)
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
      .finally(() => {
        inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, request);
  }

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
