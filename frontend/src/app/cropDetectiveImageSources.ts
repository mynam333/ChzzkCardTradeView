export type CropDetectiveImageSourceKind =
  | 'resized-proxy'
  | 'original-proxy'
  | 'raw'
  | 'backend-fallback';

export type CropDetectiveImageSource = {
  kind: CropDetectiveImageSourceKind;
  url: string;
};

export type ResolvedCropDetectiveImageSource<T> = {
  source: CropDetectiveImageSource;
  value: T;
};

type ResolveCropDetectiveImageSourceInput<T> = {
  sources: readonly CropDetectiveImageSource[];
  timeoutMs: number;
  load: (source: CropDetectiveImageSource) => Promise<T | null> | T | null;
};

type CropDetectiveImageSourceInput = {
  resizedProxyUrl?: string | null;
  originalProxyUrl?: string | null;
  rawUrl?: string | null;
  backendFallbackUrl?: string | null;
  preferOriginal?: boolean;
};

export const CROP_DETECTIVE_IMAGE_REQUEST_PROFILES = {
  choice: {
    width: 360,
    quality: 82,
    /** Total budget for the complete network fallback chain. */
    timeoutMs: 13_000,
    retainResolved: true
  },
  preview: {
    width: 768,
    quality: 92,
    /** Total budget for the complete network fallback chain. */
    timeoutMs: 13_000,
    retainResolved: false
  }
} as const;

type CropDetectiveCssCropGeometryInput = {
  x: number;
  y: number;
  size: number;
  rotation?: number;
  aspectRatio?: number;
};

/**
 * Positions the complete card image behind the square clue viewport. The analysis
 * canvas only chooses x/y; the browser renders the decoded source directly so the
 * clue is never upscaled from the small analysis bitmap or re-encoded.
 */
export const createCropDetectiveCssCropGeometry = ({
  x,
  y,
  size,
  rotation = 0,
  aspectRatio = 5 / 8
}: CropDetectiveCssCropGeometryInput) => {
  const safeX = Number.isFinite(x) ? x : 0.5;
  const safeY = Number.isFinite(y) ? y : 0.5;
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0.08;
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 5 / 8;
  const widthPercent = 100 / safeSize;
  const heightPercent = widthPercent / safeAspectRatio;
  const normalizedRotation = ((Math.trunc(Number.isFinite(rotation) ? rotation : 0) % 360) + 360) % 360;

  return {
    widthPercent,
    heightPercent,
    leftPercent: 50 - safeX * widthPercent,
    topPercent: 50 - safeY * heightPercent,
    rotationDegrees: normalizedRotation
  };
};

/** Keeps the requested priority while removing duplicate/empty network URLs. */
export const createCropDetectiveImageSourceChain = ({
  resizedProxyUrl,
  originalProxyUrl,
  rawUrl,
  backendFallbackUrl,
  preferOriginal = false
}: CropDetectiveImageSourceInput): CropDetectiveImageSource[] => {
  const primaryCandidates: Array<[CropDetectiveImageSourceKind, string | null | undefined]> = preferOriginal
    ? [['original-proxy', originalProxyUrl], ['resized-proxy', resizedProxyUrl]]
    : [['resized-proxy', resizedProxyUrl], ['original-proxy', originalProxyUrl]];
  const candidates: Array<[CropDetectiveImageSourceKind, string | null | undefined]> = [
    ...primaryCandidates,
    ['raw', rawUrl],
    ['backend-fallback', backendFallbackUrl]
  ];
  const seen = new Set<string>();
  const sources: CropDetectiveImageSource[] = [];

  for (const [kind, candidate] of candidates) {
    const url = String(candidate || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ kind, url });
  }

  return sources;
};

export type CropDetectiveCropPoint = { x: number; y: number };
type CropDetectiveCropBounds = { minX: number; maxX: number; minY: number; maxY: number };
export const CROP_DETECTIVE_VERIFICATION_ATTEMPTS = 3;

const hashStringToSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

/** Builds exactly three reproducible positions from the real card image. */
export const createCropDetectiveVerificationCandidates = (
  base: CropDetectiveCropPoint,
  bounds: CropDetectiveCropBounds,
  seedSource: string
): CropDetectiveCropPoint[] => {
  const clampX = (value: number) => Math.max(bounds.minX, Math.min(bounds.maxX, value));
  const clampY = (value: number) => Math.max(bounds.minY, Math.min(bounds.maxY, value));
  const random = createSeededRandom(hashStringToSeed(seedSource));
  const candidates: CropDetectiveCropPoint[] = [{ x: clampX(base.x), y: clampY(base.y) }];
  const rangeX = Math.max(0, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0, bounds.maxY - bounds.minY);
  const range = Math.max(rangeX, rangeY);
  const pushCandidate = (candidate: CropDetectiveCropPoint) => {
    const clamped = { x: clampX(candidate.x), y: clampY(candidate.y) };
    const duplicate = candidates.some((item) => (
      Math.abs(item.x - clamped.x) < 0.001 && Math.abs(item.y - clamped.y) < 0.001
    ));
    if (!duplicate) candidates.push(clamped);
  };

  let randomAttempts = 0;
  while (candidates.length < CROP_DETECTIVE_VERIFICATION_ATTEMPTS && randomAttempts < 24) {
    const retryIndex = candidates.length - 1;
    const radiusRatio = retryIndex === 0 ? 0.32 : 0.58;
    const angle = random() * Math.PI * 2;
    const radius = range * radiusRatio * (0.72 + random() * 0.28);
    pushCandidate({
      x: base.x + Math.cos(angle) * radius,
      y: base.y + Math.sin(angle) * radius
    });
    randomAttempts += 1;
  }

  for (const candidate of [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY }
  ]) {
    if (candidates.length >= CROP_DETECTIVE_VERIFICATION_ATTEMPTS) break;
    pushCandidate(candidate);
  }
  while (candidates.length < CROP_DETECTIVE_VERIFICATION_ATTEMPTS) {
    candidates.push({ ...candidates[candidates.length - 1] });
  }
  return candidates.slice(0, CROP_DETECTIVE_VERIFICATION_ATTEMPTS);
};

/** Returns the first acceptable attempt, or the third real crop when all fail. */
export const selectCropDetectiveVerificationCandidate = <T>(
  candidates: readonly T[],
  isAcceptable: (candidate: T, attemptIndex: number) => boolean
): T | null => {
  const attempts = candidates.slice(0, CROP_DETECTIVE_VERIFICATION_ATTEMPTS);
  let selected: T | null = null;
  for (let index = 0; index < attempts.length; index += 1) {
    selected = attempts[index];
    if (isAcceptable(selected, index)) break;
  }
  return selected;
};

/**
 * Resolves the real image source chain within one shared time budget. A failed
 * chain deliberately returns null: Crop Detective must never replace a card
 * with generated artwork.
 */
export const resolveCropDetectiveImageSource = async <T>({
  sources,
  timeoutMs,
  load
}: ResolveCropDetectiveImageSourceInput<T>): Promise<ResolvedCropDetectiveImageSource<T> | null> => {
  const finiteTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const deadlineAt = Date.now() + finiteTimeoutMs;

  for (const source of sources) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) break;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), remainingMs);
    });
    const request = Promise.resolve()
      .then(() => load(source))
      .catch(() => null);

    try {
      const value = await Promise.race([request, timeout]);
      if (value !== null) {
        return {
          source,
          value
        };
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  return null;
};

export const areCropDetectiveAssetsSettled = (
  requiredAssetIds: readonly string[],
  settledAssetIds: readonly string[]
) => {
  if (requiredAssetIds.length === 0) return false;
  const settled = new Set(settledAssetIds);
  return requiredAssetIds.every((assetId) => settled.has(assetId));
};

