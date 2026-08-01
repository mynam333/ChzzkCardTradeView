import crypto from 'crypto';
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { toMysqlDateTime } from '../repositories/mysql/dateUtils';
import { createPinnedLookup, validateSafeOutboundUrl } from '../utils/outboundNetworkSafety';

export type ChatLinkPreview = {
  url: string;
  normalized_url: string;
  kind: 'link' | 'youtube';
  site_name?: string | null;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  provider?: string | null;
  video_id?: string | null;
  embed_url?: string | null;
  fetched_at: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;
const PREVIEW_TIMEOUT_MS = 2500;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_METADATA_TAG_CANDIDATES = 4_096;
const MAX_METADATA_TAG_LENGTH = 4_096;
const MAX_TITLE_CONTENT_LENGTH = 8_192;
const SUCCESS_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = Math.max(50, Number(process.env.LINK_PREVIEW_MEMORY_CACHE_MAX_ENTRIES || 1000));
const cache = new Map<string, { expiresAt: number; preview: ChatLinkPreview | null }>();

const deleteOldestCacheEntry = () => {
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
};

const pruneMemoryCache = (now = Date.now()) => {
  for (const [key, item] of cache) {
    if (item.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MEMORY_CACHE_MAX_ENTRIES) deleteOldestCacheEntry();
};

const setMemoryCache = (normalizedUrl: string, item: { expiresAt: number; preview: ChatLinkPreview | null }) => {
  cache.delete(normalizedUrl);
  cache.set(normalizedUrl, {
    ...item,
    preview: sanitizeChatLinkPreviewForDelivery(item.preview)
  });
  if (cache.size > MEMORY_CACHE_MAX_ENTRIES) pruneMemoryCache();
};

const trimText = (value?: string | null, max = 280) => {
  if (!value) return null;
  const decoded = value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return decoded ? decoded.slice(0, max) : null;
};

export const extractFirstUrl = (text: string): string | null => {
  const match = String(text || '').match(URL_PATTERN);
  if (!match) return null;
  return match[0].replace(/[),.!?;:]+$/, '');
};

const normalizeUrl = (raw: string) => {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('UnsupportedProtocol');
  if (url.username || url.password) throw new Error('UrlCredentialsNotAllowed');
  url.hash = '';
  return url.toString();
};

const cacheKey = (normalizedUrl: string) => crypto.createHash('sha256').update(normalizedUrl).digest('hex');

export const sanitizeChatLinkPreviewForDelivery = (preview: ChatLinkPreview | null) => {
  if (!preview || preview.kind !== 'link' || !preview.image_url) return preview;
  return { ...preview, image_url: null };
};

const parseCachedPreview = (value: any): ChatLinkPreview | null => {
  if (!value) return null;
  if (typeof value === 'object') return sanitizeChatLinkPreviewForDelivery(value as ChatLinkPreview);
  try {
    return sanitizeChatLinkPreviewForDelivery(JSON.parse(String(value)) as ChatLinkPreview);
  } catch {
    return null;
  }
};

const getCachedPreviewFromDb = async (normalizedUrl: string): Promise<{ hit: boolean; preview: ChatLinkPreview | null; expiresAt: number }> => {
  const key = cacheKey(normalizedUrl);
  const mode = getDbMode();
  const now = Date.now();
  let row: any = null;
  if (mode === 'MYSQL') {
    row = await getMysqlDb().get('SELECT preview_json, status, expires_at FROM link_previews WHERE url_hash = ? LIMIT 1', key);
  } else if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('link_previews').select('preview_json, status, expires_at').eq('url_hash', key).maybeSingle();
    row = data;
  } else {
    row = getSqliteDb().prepare('SELECT preview_json, status, expires_at FROM link_previews WHERE url_hash = ? LIMIT 1').get(key);
  }
  if (!row?.expires_at) return { hit: false, preview: null, expiresAt: 0 };
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { hit: false, preview: null, expiresAt: 0 };
  return { hit: true, preview: row.status === 'success' ? parseCachedPreview(row.preview_json) : null, expiresAt };
};

const saveCachedPreviewToDb = async (normalizedUrl: string, preview: ChatLinkPreview | null) => {
  const key = cacheKey(normalizedUrl);
  const mode = getDbMode();
  const now = new Date();
  const expiresAt = new Date(Date.now() + (preview ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS));
  const previewJson = preview ? JSON.stringify(preview) : null;
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO link_previews (url_hash, normalized_url, preview_json, status, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         normalized_url = VALUES(normalized_url),
         preview_json = VALUES(preview_json),
         status = VALUES(status),
         fetched_at = VALUES(fetched_at),
         expires_at = VALUES(expires_at)`,
      key, normalizedUrl, previewJson, preview ? 'success' : 'failed', toMysqlDateTime(now), toMysqlDateTime(expiresAt)
    );
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('link_previews').upsert({
      url_hash: key,
      normalized_url: normalizedUrl,
      preview_json: previewJson,
      status: preview ? 'success' : 'failed',
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString()
    }, { onConflict: 'url_hash' });
  } else {
    getSqliteDb().prepare(
      `INSERT INTO link_previews (url_hash, normalized_url, preview_json, status, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(url_hash) DO UPDATE SET
         normalized_url = excluded.normalized_url,
         preview_json = excluded.preview_json,
         status = excluded.status,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`
    ).run(key, normalizedUrl, previewJson, preview ? 'success' : 'failed', now.toISOString(), expiresAt.toISOString());
  }
};

const assertPublicHttpUrl = async (raw: string) => {
  const normalized = normalizeUrl(raw);
  await validateSafeOutboundUrl(normalized, {
    allowedProtocols: ['http:', 'https:'],
    rejectIpLiterals: false,
    maxLength: 4_096
  });
  return normalized;
};

type PinnedFetchResponse = {
  status: number;
  ok: boolean;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

const headerValue = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Resolves and validates immediately before every connection, then pins the
 * HTTP client's lookup callback to that exact public answer. Redirects use a
 * fresh validation and a fresh pinned connection for every hop.
 */
export const fetchPinnedPublicResource = async (
  rawUrl: string,
  headers: Record<string, string>,
  maxBytes: number,
  signal: AbortSignal,
  redirects = MAX_REDIRECTS
): Promise<PinnedFetchResponse> => {
  const validated = await validateSafeOutboundUrl(rawUrl, {
    allowedProtocols: ['http:', 'https:'],
    rejectIpLiterals: false,
    maxLength: 4_096
  });
  const transport = validated.url.protocol === 'https:' ? https : http;
  const lookup = createPinnedLookup(validated.url.hostname, validated.addresses);

  return new Promise<PinnedFetchResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (response: PinnedFetchResponse) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    const request = transport.request(validated.url, {
      method: 'GET',
      headers: {
        ...headers,
        'Accept-Encoding': 'identity'
      },
      lookup,
      signal
    }, (response) => {
      const status = response.statusCode || 0;
      const location = headerValue(response.headers, 'location');
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        if (redirects <= 0) {
          fail(new Error('TooManyRedirects'));
          response.destroy();
          return;
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, validated.url);
        } catch {
          fail(new Error('InvalidRedirectUrl'));
          response.destroy();
          return;
        }
        nextUrl.hash = '';
        settled = true;
        response.destroy();
        resolve(fetchPinnedPublicResource(nextUrl.toString(), headers, maxBytes, signal, redirects - 1));
        return;
      }

      const declaredLength = Number(headerValue(response.headers, 'content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        fail(new Error('ResponseTooLarge'));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer | Uint8Array | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > maxBytes) {
          response.destroy();
          fail(new Error('ResponseTooLarge'));
          return;
        }
        chunks.push(buffer);
      });
      response.once('aborted', () => fail(new Error('ResponseAborted')));
      response.once('error', (error) => fail(error));
      response.once('end', () => succeed({
        status,
        ok: status >= 200 && status < 300,
        headers: response.headers,
        body: Buffer.concat(chunks, total)
      }));
    });
    request.once('error', (error) => fail(error));
    request.end();
  });
};

const youtubeIdFromUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) return parts[1] || null;
    }
  } catch { /* noop */ }
  return null;
};

const fetchJson = async (url: string, timeoutMs = PREVIEW_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchPinnedPublicResource(
      url,
      { 'User-Agent': 'ChikapoBot/1.0 link-preview' },
      MAX_JSON_BYTES,
      controller.signal
    );
    if (!res.ok) return null;
    return JSON.parse(res.body.toString('utf8'));
  } finally {
    clearTimeout(timer);
  }
};

const fetchLimitedHtml = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const res = await fetchPinnedPublicResource(
      url,
      {
        'User-Agent': 'ChikapoBot/1.0 link-preview',
        Accept: 'text/html,application/xhtml+xml'
      },
      MAX_HTML_BYTES,
      controller.signal
    );
    if (!res.ok) return null;
    const type = headerValue(res.headers, 'content-type') || '';
    if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) return null;
    return res.body.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
};

type BoundedHtmlMetadata = {
  propertyMeta: Map<string, string>;
  namedMeta: Map<string, string>;
  title: string | null;
};

const isHtmlSpace = (char: string | undefined) => (
  char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f'
);

const isAttributeNameChar = (char: string | undefined) => Boolean(
  char && /[a-zA-Z0-9:_-]/.test(char)
);

const parseBoundedTagAttributes = (tag: string, nameEnd: number) => {
  const attributes = new Map<string, string>();
  let cursor = nameEnd;
  while (cursor < tag.length) {
    while (cursor < tag.length && (isHtmlSpace(tag[cursor]) || tag[cursor] === '/')) cursor += 1;
    if (cursor >= tag.length || tag[cursor] === '>') break;

    const attributeStart = cursor;
    while (cursor < tag.length && isAttributeNameChar(tag[cursor])) cursor += 1;
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = tag.slice(attributeStart, cursor).toLowerCase();
    while (cursor < tag.length && isHtmlSpace(tag[cursor])) cursor += 1;
    if (tag[cursor] !== '=') continue;
    cursor += 1;
    while (cursor < tag.length && isHtmlSpace(tag[cursor])) cursor += 1;

    let value = '';
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : null;
    if (quote) {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
      if (cursor >= tag.length) break;
      value = tag.slice(valueStart, cursor);
      cursor += 1;
    } else {
      const valueStart = cursor;
      while (
        cursor < tag.length
        && !isHtmlSpace(tag[cursor])
        && tag[cursor] !== '>'
        && tag[cursor] !== '/'
      ) cursor += 1;
      value = tag.slice(valueStart, cursor);
    }
    if (!attributes.has(attributeName)) attributes.set(attributeName, value);
  }
  return attributes;
};

const findBoundedTagEnd = (html: string, openIndex: number) => {
  let quote: string | null = null;
  const limit = Math.min(html.length, openIndex + MAX_METADATA_TAG_LENGTH);
  for (let cursor = openIndex + 1; cursor < limit; cursor += 1) {
    const char = html[cursor];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return { end: cursor, next: cursor + 1 };
    if (char === '<') return { end: -1, next: cursor };
  }
  return { end: -1, next: Math.max(openIndex + 1, limit) };
};

const extractBoundedTitle = (html: string, contentStart: number) => {
  const window = html.slice(contentStart, contentStart + MAX_TITLE_CONTENT_LENGTH + 32);
  const lower = window.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const closeStart = lower.indexOf('</title', searchFrom);
    if (closeStart < 0 || closeStart > MAX_TITLE_CONTENT_LENGTH) return null;
    const boundary = lower[closeStart + 7];
    if (boundary === '>' || isHtmlSpace(boundary)) {
      const closeEnd = lower.indexOf('>', closeStart + 7);
      if (closeEnd >= 0 && closeEnd - closeStart <= MAX_METADATA_TAG_LENGTH) {
        return window.slice(0, closeStart);
      }
      return null;
    }
    searchFrom = closeStart + 1;
  }
  return null;
};

export const extractBoundedHtmlMetadata = (html: string): BoundedHtmlMetadata => {
  const propertyMeta = new Map<string, string>();
  const namedMeta = new Map<string, string>();
  let title: string | null = null;
  let titleAttempted = false;
  let cursor = 0;
  let candidates = 0;

  while (cursor < html.length && candidates < MAX_METADATA_TAG_CANDIDATES) {
    const openIndex = html.indexOf('<', cursor);
    if (openIndex < 0) break;
    candidates += 1;
    const { end, next } = findBoundedTagEnd(html, openIndex);
    cursor = next;
    if (end < 0) continue;

    let nameStart = openIndex + 1;
    if (html[nameStart] === '/') nameStart += 1;
    const nameLimit = Math.min(end, nameStart + 16);
    let nameEnd = nameStart;
    while (nameEnd < nameLimit && /[a-zA-Z0-9]/.test(html[nameEnd])) nameEnd += 1;
    const tagName = html.slice(nameStart, nameEnd).toLowerCase();
    if (tagName === 'meta' && html[openIndex + 1] !== '/') {
      const attributes = parseBoundedTagAttributes(html.slice(openIndex, end + 1), nameEnd - openIndex);
      const content = attributes.get('content');
      const property = attributes.get('property')?.trim().toLowerCase();
      const name = attributes.get('name')?.trim().toLowerCase();
      if (content !== undefined && property && !propertyMeta.has(property)) propertyMeta.set(property, content);
      if (content !== undefined && name && !namedMeta.has(name)) namedMeta.set(name, content);
      continue;
    }
    if (tagName === 'title' && html[openIndex + 1] !== '/' && !titleAttempted) {
      titleAttempted = true;
      title = extractBoundedTitle(html, end + 1);
    }
  }
  return { propertyMeta, namedMeta, title };
};

const metadataValue = (metadata: BoundedHtmlMetadata, key: string, max = 500) => trimText(
  metadata.propertyMeta.get(key.toLowerCase()) ?? metadata.namedMeta.get(key.toLowerCase()),
  max
);

const buildYoutubePreview = async (normalized: string, videoId: string): Promise<ChatLinkPreview> => {
  const oembed = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(normalized)}`).catch(() => null) as {
    title?: string;
    author_name?: string;
  } | null;
  return {
    url: normalized,
    normalized_url: normalized,
    kind: 'youtube',
    provider: 'YouTube',
    site_name: 'YouTube',
    title: trimText(oembed?.title, 160) || 'YouTube 동영상',
    description: trimText(oembed?.author_name ? `${oembed.author_name}의 영상` : null, 220),
    image_url: `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    video_id: videoId,
    embed_url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
    fetched_at: new Date().toISOString()
  };
};

export const buildGenericPreviewFromHtml = (normalized: string, html: string): ChatLinkPreview => {
  const parsed = new URL(normalized);
  const metadata = extractBoundedHtmlMetadata(html);
  const title = metadataValue(metadata, 'og:title')
    || metadataValue(metadata, 'twitter:title')
    || trimText(metadata.title, 160);
  const description = metadataValue(metadata, 'og:description')
    || metadataValue(metadata, 'description')
    || metadataValue(metadata, 'twitter:description');
  return {
    url: normalized,
    normalized_url: normalized,
    kind: 'link',
    provider: null,
    site_name: metadataValue(metadata, 'og:site_name') || parsed.hostname.replace(/^www\./, ''),
    title: title || parsed.hostname.replace(/^www\./, ''),
    description: trimText(description, 220),
    // Arbitrary page-controlled images would make every recipient's browser
    // contact a tracker or private-network URL. Generic previews omit them
    // until they can be served through a pinned, allow-listed server proxy.
    image_url: null,
    fetched_at: new Date().toISOString()
  };
};

const buildGenericPreview = async (normalized: string): Promise<ChatLinkPreview | null> => {
  const html = await fetchLimitedHtml(normalized);
  return html ? buildGenericPreviewFromHtml(normalized, html) : null;
};

export const getLinkPreviewForText = async (text: string): Promise<ChatLinkPreview | null> => {
  const firstUrl = extractFirstUrl(text);
  if (!firstUrl) return null;
  try {
    const normalized = await assertPublicHttpUrl(firstUrl);
    const cached = cache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(normalized);
      const preview = sanitizeChatLinkPreviewForDelivery(cached.preview);
      cache.set(normalized, { ...cached, preview });
      return preview;
    }
    if (cached) cache.delete(normalized);

    const dbCached = await getCachedPreviewFromDb(normalized);
    if (dbCached.hit) {
      setMemoryCache(normalized, { preview: dbCached.preview, expiresAt: dbCached.expiresAt });
      return dbCached.preview;
    }

    const videoId = youtubeIdFromUrl(normalized);
    const preview = videoId
      ? await buildYoutubePreview(normalized, videoId)
      : await buildGenericPreview(normalized);
    const expiresAt = Date.now() + (preview ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS);
    setMemoryCache(normalized, { preview, expiresAt });
    await saveCachedPreviewToDb(normalized, preview);
    return preview;
  } catch {
    return null;
  }
};
