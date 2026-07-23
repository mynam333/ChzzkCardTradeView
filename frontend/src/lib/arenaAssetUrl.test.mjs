import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveArenaAssetUrlForBase } from './arenaAssetUrl.ts';

test('backend upload paths resolve from the API origin instead of the API namespace', () => {
  assert.equal(
    resolveArenaAssetUrlForBase('/uploads/cards/sample.webp', 'https://api.yuaru.com/api'),
    'https://api.yuaru.com/uploads/cards/sample.webp'
  );
  assert.equal(
    resolveArenaAssetUrlForBase('uploads/emotes/sample.webp', 'https://api.yuaru.com/api/'),
    'https://api.yuaru.com/uploads/emotes/sample.webp'
  );
});

test('legacy upload URLs on the backend hostname are normalized without changing the asset path', () => {
  assert.equal(
    resolveArenaAssetUrlForBase(
      'http://api.yuaru.com:5000/api/uploads/cards/sample.webp?v=2#art',
      'https://api.yuaru.com/api'
    ),
    'https://api.yuaru.com/uploads/cards/sample.webp?v=2#art'
  );
});

test('third-party CDN assets are preserved even when their path contains uploads', () => {
  assert.equal(
    resolveArenaAssetUrlForBase(
      'https://cdn.example.com/uploads/emotes/sample.webp',
      'https://api.yuaru.com/api'
    ),
    'https://cdn.example.com/uploads/emotes/sample.webp'
  );
});

test('relative API configuration keeps root-relative upload URLs deterministic', () => {
  assert.equal(
    resolveArenaAssetUrlForBase('/uploads/cards/sample.webp', '/api'),
    '/uploads/cards/sample.webp'
  );
});

test('safe inline assets and unrelated root assets keep their original URL', () => {
  assert.equal(resolveArenaAssetUrlForBase('data:image/svg+xml,ok', '/api'), 'data:image/svg+xml,ok');
  assert.equal(resolveArenaAssetUrlForBase('blob:https://example.com/asset', '/api'), 'blob:https://example.com/asset');
  assert.equal(resolveArenaAssetUrlForBase('/icon.png', '/api'), '/icon.png');
  assert.equal(resolveArenaAssetUrlForBase('not-a-url', '/api'), '');
});
