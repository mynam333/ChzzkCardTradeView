import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ArcadeTab.tsx', import.meta.url), 'utf8');
const protectedPreviewStart = source.indexOf('const ProtectedCropPreview');
const protectedPreviewEnd = source.indexOf('const ClientCropPreview');
const protectedPreview = source.slice(protectedPreviewStart, protectedPreviewEnd);

test('protected crop only settles after a real protected image loads', () => {
  assert.ok(protectedPreviewStart >= 0 && protectedPreviewEnd > protectedPreviewStart);
  assert.doesNotMatch(protectedPreview, /element\.src\s*=\s*['"]\/icon\.png/);
  assert.match(protectedPreview, /element\.src\.endsWith\('\/icon\.png'\)\) return/);
  assert.match(protectedPreview, /element\.dataset\.prepared = 'true'/);
  assert.match(protectedPreview, /onPrepared\?\.\(roundKey\)/);
});

test('protected crop retries an encrypted fallback before one bounded session refresh', () => {
  assert.match(protectedPreview, /element\.src = fallbackUrl/);
  assert.match(protectedPreview, /onLoadFailed\(roundKey\)/);
  assert.match(source, /previousAttempts >= 1/);
  assert.match(source, /fetchActiveCropDetectiveSession\(\)/);
  assert.match(source, /recoveryRequestId !== cropImageRecoveryRequestRef\.current/);
  assert.match(source, /latestContext\.roundKey !== failedRoundKey/);
  assert.match(source, /restoreCropDetectiveSession\(activeSession, \{ silent: true \}\)/);
  assert.match(source, /<CropPreview\s+key=\{roundKey\}/);
});
