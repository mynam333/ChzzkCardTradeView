import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

export type PuzzleExcludedImageInput = {
  imageUrl: string;
  sourceReportId?: number | null;
  channelId?: string | null;
  star?: number | null;
  reason?: string | null;
  createdBy?: string | null;
};

export type PuzzleExcludedImageRecord = {
  image_key: string;
  image_url: string;
  source_report_id: number | null;
  channel_id: string | null;
  star: number | null;
  reason: string | null;
  created_by: string | null;
  created_at?: string | null;
};

const CACHE_TTL_MS = 60_000;
let excludedKeysCache: { keys: Set<string>; expiresAt: number } | null = null;
let warnedSupabaseReadFailure = false;

export const normalizePuzzleImageKey = (rawUrl: string | null | undefined): string => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed, 'https://chikapo.local');
    const pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    const lowerPath = pathname.toLowerCase();
    const uploadsIndex = lowerPath.indexOf('/uploads/');
    if (uploadsIndex >= 0) {
      return `uploads:${decodeURIComponent(lowerPath.slice(uploadsIndex + '/uploads/'.length))}`;
    }
    const host = parsed.hostname && parsed.hostname !== 'chikapo.local'
      ? `${parsed.hostname.toLowerCase()}:`
      : '';
    return `url:${host}${decodeURIComponent(lowerPath)}`;
  } catch {
    return `raw:${trimmed.split(/[?#]/, 1)[0].toLowerCase()}`;
  }
};

export const clearPuzzleExcludedImageCache = () => {
  excludedKeysCache = null;
};

export const getPuzzleExcludedImageKeys = async (): Promise<Set<string>> => {
  const now = Date.now();
  if (excludedKeysCache && excludedKeysCache.expiresAt > now) {
    return new Set(excludedKeysCache.keys);
  }

  let rows: Array<{ image_key: string }> = [];
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    rows = await getMysqlDb().all('SELECT image_key FROM puzzle_excluded_images');
  } else if (mode === 'LOCAL_SQL') {
    rows = getSqliteDb().prepare('SELECT image_key FROM puzzle_excluded_images').all() as Array<{ image_key: string }>;
  } else {
    try {
      const { data, error } = await getSupabaseClient()
        .from('puzzle_excluded_images')
        .select('image_key');
      if (error) throw error;
      rows = data || [];
    } catch (err: any) {
      if (!warnedSupabaseReadFailure) {
        warnedSupabaseReadFailure = true;
        console.warn('[PuzzleImageExclusion] Supabase 제외 이미지 조회 실패, 빈 목록으로 진행합니다:', err?.message || err);
      }
      rows = [];
    }
  }

  const keys = new Set(rows.map((row) => row.image_key).filter(Boolean));
  excludedKeysCache = { keys, expiresAt: now + CACHE_TTL_MS };
  return new Set(keys);
};

export const isPuzzleImageExcluded = async (imageUrl: string | null | undefined): Promise<boolean> => {
  const imageKey = normalizePuzzleImageKey(imageUrl);
  if (!imageKey) return false;
  const keys = await getPuzzleExcludedImageKeys();
  return keys.has(imageKey);
};

export const addPuzzleExcludedImage = async (input: PuzzleExcludedImageInput): Promise<PuzzleExcludedImageRecord> => {
  const imageUrl = input.imageUrl.trim();
  const imageKey = normalizePuzzleImageKey(imageUrl);
  if (!imageKey) {
    throw new Error('INVALID_IMAGE_URL');
  }

  const record: PuzzleExcludedImageRecord = {
    image_key: imageKey,
    image_url: imageUrl,
    source_report_id: input.sourceReportId ?? null,
    channel_id: input.channelId ?? null,
    star: input.star ?? null,
    reason: input.reason?.slice(0, 500) ?? null,
    created_by: input.createdBy ?? null
  };

  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO puzzle_excluded_images
        (image_key, image_url, source_report_id, channel_id, star, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        image_url = VALUES(image_url),
        source_report_id = COALESCE(VALUES(source_report_id), source_report_id),
        channel_id = COALESCE(VALUES(channel_id), channel_id),
        star = COALESCE(VALUES(star), star),
        reason = COALESCE(VALUES(reason), reason),
        created_by = COALESCE(VALUES(created_by), created_by)`,
      record.image_key,
      record.image_url,
      record.source_report_id,
      record.channel_id,
      record.star,
      record.reason,
      record.created_by
    );
  } else if (mode === 'LOCAL_SQL') {
    getSqliteDb().prepare(
      `INSERT INTO puzzle_excluded_images
        (image_key, image_url, source_report_id, channel_id, star, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(image_key) DO UPDATE SET
        image_url = excluded.image_url,
        source_report_id = COALESCE(excluded.source_report_id, puzzle_excluded_images.source_report_id),
        channel_id = COALESCE(excluded.channel_id, puzzle_excluded_images.channel_id),
        star = COALESCE(excluded.star, puzzle_excluded_images.star),
        reason = COALESCE(excluded.reason, puzzle_excluded_images.reason),
        created_by = COALESCE(excluded.created_by, puzzle_excluded_images.created_by)`
    ).run(
      record.image_key,
      record.image_url,
      record.source_report_id,
      record.channel_id,
      record.star,
      record.reason,
      record.created_by
    );
  } else {
    const { error } = await getSupabaseClient()
      .from('puzzle_excluded_images')
      .upsert(record, { onConflict: 'image_key' });
    if (error) throw error;
  }

  clearPuzzleExcludedImageCache();
  return record;
};
