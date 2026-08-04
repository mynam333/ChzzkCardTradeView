import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROP_DETECTIVE_IMAGE_REQUEST_PROFILES,
  CROP_DETECTIVE_VERIFICATION_ATTEMPTS,
  areCropDetectiveAssetsSettled,
  createCropDetectiveCssCropGeometry,
  createCropDetectiveImageSourceChain,
  createCropDetectiveVerificationCandidates,
  resolveCropDetectiveImageSource,
  selectCropDetectiveVerificationCandidate
} from './cropDetectiveImageSources.ts';

test('image source chain preserves real-source fallback order and deduplicates URLs', () => {
  const chain = createCropDetectiveImageSourceChain({
    resizedProxyUrl: '/api/image-proxy?url=card&w=360',
    originalProxyUrl: '/api/image-proxy?url=card',
    rawUrl: 'https://cdn.example.com/card.png',
    backendFallbackUrl: '/api/image-proxy?url=fallback-card&w=360'
  });

  assert.deepEqual(chain.map((source) => source.kind), [
    'resized-proxy',
    'original-proxy',
    'raw',
    'backend-fallback'
  ]);
  assert.equal(chain.some((source) => source.url.startsWith('data:')), false);
});

test('preview uses one bounded high-resolution source while answer choices stay lightweight', () => {
  const { preview, choice } = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES;
  assert.equal(choice.width, 360);
  assert.equal(choice.quality, 82);
  assert.equal(choice.timeoutMs, 13_000);
  assert.ok(preview.width > 480, 'preview must bypass the pstatic 240px derivative');
  assert.equal(preview.width, 768);
  assert.equal(preview.quality, 92);
  assert.equal(preview.timeoutMs, 13_000);
  assert.equal(preview.retainResolved, false);
});

test('local uploads can prefer their original pixels without losing the fallback chain', () => {
  const chain = createCropDetectiveImageSourceChain({
    resizedProxyUrl: '/api/image-proxy?url=%2Fuploads%2Fcard.webp&w=768',
    originalProxyUrl: '/uploads/card.webp',
    rawUrl: '/uploads/card.webp',
    backendFallbackUrl: '/api/image-proxy?url=%2Fuploads%2Ffallback.webp&w=768',
    preferOriginal: true
  });

  assert.deepEqual(chain.slice(0, 3).map((source) => source.kind), [
    'original-proxy',
    'resized-proxy',
    'backend-fallback'
  ]);
  assert.equal(chain.some((source) => source.url.startsWith('data:')), false);
});

test('CSS crop geometry keeps the selected card point centered at every zoom level', () => {
  const geometry = createCropDetectiveCssCropGeometry({
    x: 0.5,
    y: 0.5,
    size: 0.1,
    rotation: -90
  });

  assert.deepEqual(geometry, {
    widthPercent: 1000,
    heightPercent: 1600,
    leftPercent: -450,
    topPercent: -750,
    rotationDegrees: 270
  });

  const offCenter = createCropDetectiveCssCropGeometry({ x: 0.31, y: 0.67, size: 0.07, rotation: 450 });
  assert.ok(Math.abs(offCenter.leftPercent + 0.31 * offCenter.widthPercent - 50) < 1e-9);
  assert.ok(Math.abs(offCenter.topPercent + 0.67 * offCenter.heightPercent - 50) < 1e-9);
  assert.ok(Math.abs(offCenter.widthPercent / offCenter.heightPercent - 5 / 8) < 1e-9);
  assert.equal(offCenter.rotationDegrees, 90);
});

test('atomic reveal waits until crop and all four choices have settled', () => {
  const required = ['crop', 'choice:a', 'choice:b', 'choice:c', 'choice:d'];
  assert.equal(areCropDetectiveAssetsSettled(required, required.slice(0, 4)), false);
  assert.equal(areCropDetectiveAssetsSettled(required, [...required, 'choice:a']), true);
  assert.equal(areCropDetectiveAssetsSettled([], []), false);
});

test('crop verification generates exactly three real-image positions', () => {
  const candidates = createCropDetectiveVerificationCandidates(
    { x: 0.5, y: 0.5 },
    { minX: 0.1, maxX: 0.9, minY: 0.1, maxY: 0.9 },
    'round-1'
  );

  assert.equal(CROP_DETECTIVE_VERIFICATION_ATTEMPTS, 3);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates[0], { x: 0.5, y: 0.5 });
  assert.ok(candidates.every(({ x, y }) => x >= 0.1 && x <= 0.9 && y >= 0.1 && y <= 0.9));
});

test('crop verification returns the third real crop when all three checks fail', () => {
  const candidates = [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.8 },
    { x: 0.9, y: 0.9 }
  ];
  const inspected = [];
  const selected = selectCropDetectiveVerificationCandidate(candidates, (candidate) => {
    inspected.push(candidate);
    return false;
  });

  assert.deepEqual(inspected, candidates.slice(0, 3));
  assert.deepEqual(selected, candidates[2]);
});

test('a never-resolving real image chain fails within the total budget', { timeout: 500 }, async () => {
  const sources = createCropDetectiveImageSourceChain({
    resizedProxyUrl: 'https://cdn.example.com/never-resolves.webp',
    originalProxyUrl: 'https://cdn.example.com/not-started.webp'
  });
  const attemptedKinds = [];

  const resolved = await resolveCropDetectiveImageSource({
    sources,
    timeoutMs: 10,
    load: (source) => {
      attemptedKinds.push(source.kind);
      return new Promise(() => {});
    }
  });

  assert.deepEqual(attemptedKinds, ['resized-proxy']);
  assert.equal(resolved, null);
});

test('rejected and failed real image loads return null without generated artwork', async () => {
  const sources = createCropDetectiveImageSourceChain({
    resizedProxyUrl: 'https://cdn.example.com/rejected.webp',
    originalProxyUrl: 'https://cdn.example.com/failed.webp',
    rawUrl: 'https://cdn.example.com/raw.webp'
  });
  const attemptedKinds = [];

  const resolved = await resolveCropDetectiveImageSource({
    sources,
    timeoutMs: 100,
    load: (source) => {
      attemptedKinds.push(source.kind);
      if (source.kind === 'resized-proxy') return Promise.reject(new Error('proxy rejected'));
      return null;
    }
  });

  assert.deepEqual(attemptedKinds, ['resized-proxy', 'original-proxy', 'raw']);
  assert.equal(resolved, null);
});

test('the first successful intermediate real source wins', async () => {
  const sources = createCropDetectiveImageSourceChain({
    resizedProxyUrl: 'https://cdn.example.com/rejected.webp',
    originalProxyUrl: 'https://cdn.example.com/original.webp',
    rawUrl: 'https://cdn.example.com/not-needed.webp'
  });
  const attemptedKinds = [];

  const resolved = await resolveCropDetectiveImageSource({
    sources,
    timeoutMs: 100,
    load: (source) => {
      attemptedKinds.push(source.kind);
      if (source.kind === 'resized-proxy') return Promise.reject(new Error('proxy rejected'));
      return source.kind === 'original-proxy' ? 'decoded-original' : 'unexpected';
    }
  });

  assert.deepEqual(attemptedKinds, ['resized-proxy', 'original-proxy']);
  assert.equal(resolved?.source.kind, 'original-proxy');
  assert.equal(resolved?.value, 'decoded-original');
});
