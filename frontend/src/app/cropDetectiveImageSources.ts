export type CropDetectiveImageSourceKind =
  | 'resized-proxy'
  | 'original-proxy'
  | 'raw'
  | 'backend-fallback'
  | 'local-fallback';

export type CropDetectiveImageSource = {
  kind: CropDetectiveImageSourceKind;
  url: string;
  guaranteed: boolean;
};

type CropDetectiveImageSourceInput = {
  resizedProxyUrl?: string | null;
  originalProxyUrl?: string | null;
  rawUrl?: string | null;
  backendFallbackUrl?: string | null;
  fallbackSeed: string;
};

const hashStringToUint32 = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const colorFromSeed = (seed: number, offset: number) => {
  const hue = (seed + offset) % 360;
  return `hsl(${hue} 72% 52%)`;
};

/**
 * A self-contained 5:8 image used only after every network source failed.
 * It is deterministic per original URL, so the clue and its matching answer
 * still share the same artwork even during a complete upstream outage.
 */
export const createCropDetectiveFallbackDataUrl = (seedValue: string) => {
  const seed = hashStringToUint32(seedValue || 'chikapo-crop-detective');
  const primary = colorFromSeed(seed, 0);
  const secondary = colorFromSeed(seed, 83);
  const accent = colorFromSeed(seed, 191);
  const rotation = seed % 180;
  const circleX = 90 + (seed % 320);
  const circleY = 150 + ((seed >>> 7) % 420);
  const circleRadius = 70 + ((seed >>> 15) % 95);
  const lineOffset = 24 + ((seed >>> 21) % 72);
  const mark = (seed % 997).toString().padStart(3, '0');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="800" viewBox="0 0 500 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient><pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})"><path d="M0 ${lineOffset}H96M${lineOffset} 0V96" stroke="rgba(255,255,255,.16)" stroke-width="12"/></pattern></defs><rect width="500" height="800" fill="url(#g)"/><rect width="500" height="800" fill="url(#p)"/><circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="${accent}" fill-opacity=".78"/><circle cx="${500 - circleX}" cy="${800 - circleY}" r="${Math.round(circleRadius * 0.58)}" fill="none" stroke="rgba(255,255,255,.58)" stroke-width="24"/><path d="M42 690L178 514l104 92 176-244v396H42z" fill="rgba(9,9,11,.34)"/><text x="250" y="746" text-anchor="middle" fill="rgba(255,255,255,.86)" font-family="system-ui,sans-serif" font-size="38" font-weight="800" letter-spacing="8">${mark}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

/** Keeps the requested priority while removing duplicate/empty network URLs. */
export const createCropDetectiveImageSourceChain = ({
  resizedProxyUrl,
  originalProxyUrl,
  rawUrl,
  backendFallbackUrl,
  fallbackSeed
}: CropDetectiveImageSourceInput): CropDetectiveImageSource[] => {
  const candidates: Array<[CropDetectiveImageSourceKind, string | null | undefined]> = [
    ['resized-proxy', resizedProxyUrl],
    ['original-proxy', originalProxyUrl],
    ['raw', rawUrl],
    ['backend-fallback', backendFallbackUrl]
  ];
  const seen = new Set<string>();
  const sources: CropDetectiveImageSource[] = [];

  for (const [kind, candidate] of candidates) {
    const url = String(candidate || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ kind, url, guaranteed: false });
  }

  sources.push({
    kind: 'local-fallback',
    url: createCropDetectiveFallbackDataUrl(fallbackSeed),
    guaranteed: true
  });
  return sources;
};

export const areCropDetectiveAssetsSettled = (
  requiredAssetIds: readonly string[],
  settledAssetIds: readonly string[]
) => {
  if (requiredAssetIds.length === 0) return false;
  const settled = new Set(settledAssetIds);
  return requiredAssetIds.every((assetId) => settled.has(assetId));
};

