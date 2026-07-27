import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areCropDetectiveAssetsSettled,
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

test('atomic reveal waits until crop and all four choices have settled', () => {
  const required = ['crop', 'choice:a', 'choice:b', 'choice:c', 'choice:d'];
  assert.equal(areCropDetectiveAssetsSettled(required, required.slice(0, 4)), false);
  assert.equal(areCropDetectiveAssetsSettled(required, [...required, 'choice:a']), true);
  assert.equal(areCropDetectiveAssetsSettled([], []), false);
});
