import dns from 'dns/promises';
import crypto from 'crypto';
import net from 'net';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { toMysqlDateTime } from '../repositories/mysql/dateUtils';

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
  cache.set(normalizedUrl, item);
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
  url.hash = '';
  return url.toString();
};

const cacheKey = (normalizedUrl: string) => crypto.createHash('sha256').update(normalizedUrl).digest('hex');

const parseCachedPreview = (value: any): ChatLinkPreview | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as ChatLinkPreview;
  try { return JSON.parse(String(value)); } catch { return null; }
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

const isPrivateIp = (ip: string) => {
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return isPrivateIp(ip.slice(7));
  }
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }
  if (net.isIPv6(ip)) {
    const lowered = ip.toLowerCase();
    return lowered === '::1' || lowered.startsWith('fc') || lowered.startsWith('fd') || lowered.startsWith('fe80:');
  }
  return true;
};

const safeFetch = async (rawUrl: string, init: RequestInit, redirects = 3): Promise<Response> => {
  const url = await assertPublicHttpUrl(rawUrl);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status) && redirects > 0) {
    const location = res.headers.get('location');
    if (!location) return res;
    const next = new URL(location, url).toString();
    return safeFetch(next, init, redirects - 1);
  }
  return res;
};

const assertPublicHttpUrl = async (raw: string) => {
  const normalized = normalizeUrl(raw);
  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('BlockedHost');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('BlockedHost');
    return normalized;
  }
  const records = await dns.lookup(host, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error('BlockedHost');
  }
  return normalized;
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
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ChikapoBot/1.0 link-preview' }
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchLimitedHtml = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ChikapoBot/1.0 link-preview',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
};

const meta = (html: string, key: string) => {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${key}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return trimText(match[1], 500);
  }
  return null;
};

const titleTag = (html: string) => trimText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 160);

const absolutize = (maybeUrl: string | null, base: string) => {
  if (!maybeUrl) return null;
  try {
    const url = new URL(maybeUrl, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
};

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

const buildGenericPreview = async (normalized: string): Promise<ChatLinkPreview | null> => {
  const html = await fetchLimitedHtml(normalized);
  if (!html) return null;
  const parsed = new URL(normalized);
  const title = meta(html, 'og:title') || meta(html, 'twitter:title') || titleTag(html);
  const description = meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description');
  const image = absolutize(meta(html, 'og:image') || meta(html, 'twitter:image'), normalized);
  return {
    url: normalized,
    normalized_url: normalized,
    kind: 'link',
    provider: null,
    site_name: meta(html, 'og:site_name') || parsed.hostname.replace(/^www\./, ''),
    title: title || parsed.hostname.replace(/^www\./, ''),
    description: trimText(description, 220),
    image_url: image,
    fetched_at: new Date().toISOString()
  };
};

export const getLinkPreviewForText = async (text: string): Promise<ChatLinkPreview | null> => {
  const firstUrl = extractFirstUrl(text);
  if (!firstUrl) return null;
  try {
    const normalized = await assertPublicHttpUrl(firstUrl);
    const cached = cache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(normalized);
      cache.set(normalized, cached);
      return cached.preview;
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
