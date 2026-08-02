import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ArcadeTab.tsx', import.meta.url), 'utf8');
const protectedPreviewStart = source.indexOf('const ProtectedCropPreview');
const protectedPreviewEnd = source.indexOf('const ClientCropPreview');
const protectedPreview = source.slice(protectedPreviewStart, protectedPreviewEnd);

test('protected crop only settles after a real protected image loads', () => {
  assert.ok(protectedPreviewStart >= 0 && protectedPreviewEnd > protectedPreviewStart);
  assert.doesNotMatch(protectedPreview, /src=\{['"]\/icon\.png['"]\}/);
  assert.match(protectedPreview, /onLoad=\{\(\) => \{/);
  assert.match(protectedPreview, /setLoadState\('loaded'\)/);
  assert.match(protectedPreview, /onPrepared\?\.\(roundKey, \{ forceLocalFallback, localDeadlineAt \}\)/);
  assert.match(protectedPreview, /X-Minigame-Round-Deadline/);
  assert.match(protectedPreview, /X-Minigame-Server-Now/);
  assert.match(protectedPreview, /responseLocalDeadlineAt/);
});

test('protected crop has a hung-load timeout and keeps recovering without a terminal error screen', () => {
  assert.match(protectedPreview, /window\.setTimeout\(\(\) => controller\.abort\(\), 8_000\)/);
  assert.match(protectedPreview, /credentials: 'include'/);
  assert.match(protectedPreview, /onLoadFailed\(roundKey\)/);
  assert.match(protectedPreview, /Math\.min\(10_000/);
  assert.doesNotMatch(protectedPreview, /'failed'/);
  assert.doesNotMatch(source, /previousAttempts >= 1/);
  assert.match(source, /fetchActiveCropDetectiveSession\(\)/);
  assert.match(source, /recoveryRequestId !== cropImageRecoveryRequestRef\.current/);
  assert.match(source, /latestContext\.roundKey !== failedRoundKey/);
  assert.match(source, /restoreCropDetectiveSession\(activeSession, \{ silent: true \}\)/);
  assert.match(source, /cropImageRecoveryAttemptsRef/);
  assert.match(source, /await new Promise<void>\(\(resolve\) => window\.setTimeout\(resolve, retryDelayMs\)\)/);
});

test('paid crop requests the protected clue only after candidates and countdown are ready', () => {
  assert.match(source, /const canRequestProtectedCrop =[\s\S]*choicesReady &&[\s\S]*!roundChecking &&[\s\S]*!roundFeedback/);
  assert.match(source, /!protectedRound \|\| canRequestProtectedCrop \? \(/);
  assert.match(source, /if \(activeGame === 'crop_detective' && !cropDetectiveRoundReady\) return/);
  assert.match(source, /if \(activeGame === 'crop_detective' && !isPracticeMode && roundDeadlineRef\.current === null\) return/);
  assert.match(source, /setRoundTimeLeft\(getVisibleRoundTimeLeft\(localDeadlineAt\)\)/);
});

test('server deterministic clue fallback switches every candidate to matching local artwork', () => {
  assert.match(protectedPreview, /response\.headers\.get\('X-Minigame-Image-Fallback'\) === 'deterministic'/);
  assert.match(protectedPreview, /fallback=deterministic/);
  assert.match(source, /localFallbackDetected/);
  assert.match(source, /deterministicAssetIds/);
  assert.match(source, /effectiveLoadedSource\?\.url \|\| localFallbackUrl/);
  assert.match(source, /forceLocalFallback=\{forceLocalFallback\}/);
  assert.match(source, /const image = await preloadCropDetectiveImage\(source\.url, true\)/);
});

test('paid crop accepts an unarmed server contract while other paid round games still require deadlines', () => {
  assert.match(source, /gameType !== 'crop_detective' \|\| rawDeadline !== null/);
  assert.match(source, /data\.next_round_deadline_at === null && nextLocalDeadline === null/);
  assert.match(source, /roundDeadlineRef\.current = pendingRound\.localDeadlineAt/);
});

test('expired and completed resumed rounds advance without re-arming the clue', () => {
  assert.match(source, /setCropDetectiveReadyKey\(expiredRoundKey\)/);
  assert.match(source, /roundDeadlineRef\.current !== null &&[\s\S]*roundTimeLeft <= 0/);
  assert.match(source, /completedResume \|\| skipProtectedImage \? \(/);
  assert.match(source, /skipProtectedImage=\{/);
  assert.match(source, /autoSubmittedCompletedSessionsRef/);
  assert.match(source, /void submitResult\(\{ answers: roundAnswers \}\)/);
});

test('candidate fallback timeout is one total budget instead of one budget per source', () => {
  assert.match(source, /const deadlineAt = Date\.now\(\) \+ Math\.max\(0, timeoutMs\)/);
  assert.match(source, /const remainingMs = deadlineAt - Date\.now\(\)/);
  assert.match(source, /window\.setTimeout\(\(\) => resolve\(null\), remainingMs\)/);
  assert.doesNotMatch(source, /window\.setTimeout\(\(\) => resolve\(null\), timeoutMs\)/);
});
