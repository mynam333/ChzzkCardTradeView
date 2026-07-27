import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROP_DETECTIVE_IMAGE_REQUEST_PROFILES,
  areCropDetectiveAssetsSettled,
  createCropDetectiveCssCropGeometry,
  createCropDetectiveFallbackDataUrl,
  createCropDetectiveImageSourceChain
} from './cropDetectiveImageSources.ts';

test('image source chain preserves fallback order, deduplicates URLs, and always ends locally', () => {
  const chain = createCropDetectiveImageSourceChain({
    resizedProxyUrl: '/api/image-proxy?url=card&w=360',
    originalProxyUrl: '/api/image-proxy?url=card',
    rawUrl: 'https://cdn.example.com/card.png',
    backendFallbackUrl: '/api/image-proxy?url=fallback-card&w=360',
    fallbackSeed: 'https://cdn.example.com/card.png'
  });

  assert.deepEqual(chain.map((source) => source.kind), [
    'resized-proxy',
    'original-proxy',
    'raw',
    'backend-fallback',
    'local-fallback'
  ]);
  assert.equal(chain.at(-1)?.guaranteed, true);
  assert.match(chain.at(-1)?.url || '', /^data:image\/svg\+xml;charset=UTF-8,/);
});

test('fallback artwork is deterministic per original image and differs across originals', () => {
  const first = createCropDetectiveFallbackDataUrl('card-a');
  assert.equal(first, createCropDetectiveFallbackDataUrl('card-a'));
  assert.notEqual(first, createCropDetectiveFallbackDataUrl('card-b'));
});

test('preview uses one bounded high-resolution source while answer choices stay lightweight', () => {
  const { preview, choice } = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES;
  assert.equal(choice.width, 360);
  assert.equal(choice.quality, 82);
  assert.ok(preview.width > 480, 'preview must bypass the pstatic 240px derivative');
  assert.equal(preview.width, 768);
  assert.equal(preview.quality, 92);
  assert.equal(preview.retainResolved, false);
});

test('local uploads can prefer their original pixels without losing the fallback chain', () => {
  const chain = createCropDetectiveImageSourceChain({
    resizedProxyUrl: '/api/image-proxy?url=%2Fuploads%2Fcard.webp&w=768',
    originalProxyUrl: '/uploads/card.webp',
    rawUrl: '/uploads/card.webp',
    backendFallbackUrl: '/api/image-proxy?url=%2Fuploads%2Ffallback.webp&w=768',
    fallbackSeed: '/uploads/card.webp',
    preferOriginal: true
  });

  assert.deepEqual(chain.slice(0, 3).map((source) => source.kind), [
    'original-proxy',
    'resized-proxy',
    'backend-fallback'
  ]);
  assert.equal(chain.at(-1)?.guaranteed, true);
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
