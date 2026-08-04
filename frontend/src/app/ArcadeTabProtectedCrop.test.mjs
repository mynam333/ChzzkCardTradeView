import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ArcadeTab.tsx', import.meta.url), 'utf8');
const imageSourceHelper = readFileSync(new URL('./cropDetectiveImageSources.ts', import.meta.url), 'utf8');
const recoveryHelper = readFileSync(new URL('./cropDetectiveRecovery.ts', import.meta.url), 'utf8');
const protectedPreviewStart = source.indexOf('const ProtectedCropPreview');
const protectedPreviewEnd = source.indexOf('const ClientCropPreview');
const protectedPreview = source.slice(protectedPreviewStart, protectedPreviewEnd);
const clientPreviewStart = source.indexOf('const ClientCropPreview');
const clientPreviewEnd = source.indexOf('const CropPreview');
const clientPreview = source.slice(clientPreviewStart, clientPreviewEnd);
const choiceTileStart = source.indexOf('const CropDetectiveChoiceTile');
const choiceTileEnd = source.indexOf('const CropDetectiveChoices');
const choiceTile = source.slice(choiceTileStart, choiceTileEnd);
const paidAdvanceStart = source.indexOf('const advanceToPaidRound');
const paidAdvanceEnd = source.indexOf('if (!submitRetry', paidAdvanceStart);
const paidAdvanceFlow = source.slice(paidAdvanceStart, paidAdvanceEnd);
const continueStart = source.indexOf('const handleRoundContinue');
const continueEnd = source.indexOf('// 로그인 체크', continueStart);
const continueFlow = source.slice(continueStart, continueEnd);
const cropViewStart = source.indexOf('게임 5: 카드 확대 탐정');
const cropViewEnd = source.indexOf('게임 3: 짝맞추기 뒤집기', cropViewStart);
const cropView = source.slice(cropViewStart, cropViewEnd);

test('protected crop only settles after a real protected image loads', () => {
  assert.ok(protectedPreviewStart >= 0 && protectedPreviewEnd > protectedPreviewStart);
  assert.doesNotMatch(protectedPreview, /src=\{['"]\/icon\.png['"]\}/);
  assert.match(protectedPreview, /onLoad=\{\(\) => \{/);
  assert.match(protectedPreview, /setLoadState\('loaded'\)/);
  assert.match(protectedPreview, /onPrepared\?\.\(roundKey, \{[\s\S]*localDeadlineAt[\s\S]*\}\)/);
  assert.match(protectedPreview, /X-Minigame-Round-Deadline/);
  assert.match(protectedPreview, /X-Minigame-Server-Now/);
  assert.match(protectedPreview, /responseLocalDeadlineAt/);
});

test('protected crop recovery is bounded and ends in a retryable non-busy state', () => {
  assert.match(protectedPreview, /CROP_DETECTIVE_RECOVERY_POLICY\.primaryRequestTimeoutMs/);
  assert.match(protectedPreview, /credentials: 'include'/);
  assert.match(protectedPreview, /runAbortableTaskWithTimeout\([\s\S]*onLoadFailed\(roundKey, signal\)/);
  assert.match(protectedPreview, /canAutomaticallyRefreshCropDetectiveSession\(completedSessionRefreshes\)/);
  assert.match(protectedPreview, /setLoadState\('retryable'\)/);
  assert.match(protectedPreview, /aria-busy=\{loadState !== 'loaded' && loadState !== 'retryable'\}/);
  assert.match(protectedPreview, /onClick=\{handleManualRetry\}/);
  assert.match(protectedPreview, /현재 라운드와 기회는 유지됩니다/);
  assert.match(recoveryHelper, /maxAutomaticSessionRefreshes: 1/);
  assert.match(recoveryHelper, /primaryRequestTimeoutMs: 13_000/);
  assert.match(recoveryHelper, /backendNegativeCacheRetryDelayMs: 1_100/);
  assert.match(source, /await waitForAbortableDelay\([\s\S]*backendNegativeCacheRetryDelayMs/);
  assert.match(source, /fetchActiveCropDetectiveSession\(signal\)/);
  assert.match(source, /apiFetch\('\/minigames\/active\?game_type=crop_detective', \{[\s\S]*signal: requestSignal/);
  assert.match(source, /recoveryRequestId !== cropImageRecoveryRequestRef\.current/);
  assert.match(source, /latestContext\.roundKey !== failedRoundKey/);
  assert.match(source, /restoreCropDetectiveSession\(activeSession, \{ silent: true \}\)/);
  assert.match(source, /cropImageAutomaticRecoveryKeysRef\.current\.has\(stableRecoveryKey\)/);
  assert.match(source, /cropImageAutomaticRecoveryKeysRef\.current\.add\(stableRecoveryKey\)/);
  assert.doesNotMatch(source, /cropImageRecoveryAttemptsRef/);
  assert.doesNotMatch(protectedPreview, /Math\.min\(10_000/);
});

test('protected blob display also has a hard decode watchdog', () => {
  assert.match(protectedPreview, /loadState !== 'displaying' \|\| !displayUrl/);
  assert.match(protectedPreview, /CROP_DETECTIVE_RECOVERY_POLICY\.blobDecodeTimeoutMs/);
  assert.match(protectedPreview, /advanceAfterRequestFailure/);
  assert.match(protectedPreview, /loadState !== 'loaded' \|\| !revealed/);
  assert.match(protectedPreview, /preparedDisplayUrlRef/);
});

test('crop and candidate readiness follows the rendered DOM image with a finite watchdog', () => {
  assert.ok(clientPreviewStart >= 0 && clientPreviewEnd > clientPreviewStart);
  assert.ok(choiceTileStart >= 0 && choiceTileEnd > choiceTileStart);
  assert.match(clientPreview, /onLoad=\{\(\) => \{[\s\S]*notifyPrepared\(currentPreview\.imageUrl\)/);
  assert.match(clientPreview, /CROP_DETECTIVE_RECOVERY_POLICY\.blobDecodeTimeoutMs/);
  assert.match(clientPreview, /setRetryableRoundKey\(roundKey\)/);
  assert.match(clientPreview, /createCropDetectiveVerificationCandidates/);
  assert.match(clientPreview, /selectCropDetectiveVerificationCandidate/);
  assert.match(clientPreview, /applyDirectPreview\(selectedCrop \|\| \{ x, y \}\)/);
  assert.match(clientPreview, /getCropDetectiveImageSources\([\s\S]*round\.source_image_url,\s*null,/);
  assert.doesNotMatch(clientPreview, /applyDirectPreview[\s\S]{0,300}notifyPrepared/);
  assert.match(choiceTile, /onImageLoad=\{loadedSource \? handleImageLoad : undefined\}/);
  assert.match(choiceTile, /onImageError=\{loadedSource \? handleImageFailure : undefined\}/);
  assert.match(choiceTile, /CROP_DETECTIVE_RECOVERY_POLICY\.blobDecodeTimeoutMs/);
  assert.match(choiceTile, /onSettled\(assetId, roundKey\)/);
  assert.match(choiceTile, /onRenderFailed\(assetId, roundKey\)/);
  assert.match(choiceTile, /abandonedGenerationRef\.current === generationKey/);
  assert.match(choiceTile, /sourceResult\.status !== 'failed'/);
  assert.match(source, /key=\{`\$\{roundKey\}:\$\{choice\.channel_id\}:\$\{candidateRenderRetryNonce\}`\}/);
  assert.match(source, /const allImagesReady = !preparationRetryable/);
  assert.match(source, /handleAssetSettled\('crop', settledRoundKey\)/);
  assert.match(source, /candidateRetryable[\s\S]*후보 이미지를 표시하지 못했습니다[\s\S]*handleCandidateRenderRetry/);
});

test('paid crop requests the protected clue only after candidates and countdown are ready', () => {
  assert.match(source, /const canRequestProtectedCrop =[\s\S]*choicesReady &&[\s\S]*!roundChecking &&[\s\S]*!roundFeedback/);
  assert.match(source, /!protectedRound \|\| canRequestProtectedCrop \? \(/);
  assert.match(source, /if \(activeGame === 'crop_detective' && !cropDetectiveRoundReady\) return/);
  assert.match(source, /if \(activeGame === 'crop_detective' && !isPracticeMode && roundDeadlineRef\.current === null\) return/);
  assert.match(source, /setRoundTimeLeft\(getVisibleRoundTimeLeft\(localDeadlineAt\)\)/);
});

test('crop detective production code never substitutes generated artwork', () => {
  assert.doesNotMatch(source, /data:image\/svg|fallback=deterministic|forceLocalFallback|localFallbackDetected|deterministicAssetIds/);
  assert.doesNotMatch(imageSourceHelper, /data:image\/svg|createCropDetectiveFallbackDataUrl|local-fallback/);
  assert.match(protectedPreview, /generated protected crop is not allowed/);
  assert.match(imageSourceHelper, /A failed[\s\S]*chain deliberately returns null/);
  assert.match(source, /resolveCropDetectiveImageSource<HTMLImageElement>/);
});

test('paid crop accepts an unarmed server contract while other paid round games still require deadlines', () => {
  assert.match(source, /gameType !== 'crop_detective' \|\| rawDeadline !== null/);
  assert.match(source, /data\.next_round_deadline_at === null && nextLocalDeadline === null/);
  assert.match(source, /roundDeadlineRef\.current = pendingRound\.localDeadlineAt/);
});

test('paid crop keeps answer feedback visible until the next-question button is clicked', () => {
  assert.ok(paidAdvanceStart >= 0 && paidAdvanceEnd > paidAdvanceStart);
  assert.ok(continueStart >= 0 && continueEnd > continueStart);
  assert.ok(cropViewStart >= 0 && cropViewEnd > cropViewStart);
  assert.match(
    paidAdvanceFlow,
    /if \(activeGame !== 'quiz' \|\| isPracticeMode[\s\S]*window\.setTimeout\(\(\) => advanceToPaidRound/
  );
  assert.match(continueFlow, /advanceToPaidRound\(pendingPaidRound\)/);
  assert.match(cropView, /onClick=\{handleRoundContinue\}/);
  assert.match(cropView, /'다음 문제'/);
});

test('expired and completed resumed rounds advance without re-arming the clue', () => {
  assert.match(source, /setCropDetectiveReadyKey\(expiredRoundKey\)/);
  assert.match(source, /roundDeadlineRef\.current !== null &&[\s\S]*roundTimeLeft <= 0/);
  assert.match(source, /completedResume \|\| skipProtectedImage \? \(/);
  assert.match(source, /skipProtectedImage=\{/);
  assert.match(source, /autoSubmittedCompletedSessionsRef/);
  assert.match(source, /void submitResult\(\{ answers: roundAnswers \}\)/);
});

test('real image source timeout is one bounded total budget instead of one budget per source', () => {
  assert.match(imageSourceHelper, /const deadlineAt = Date\.now\(\) \+ finiteTimeoutMs/);
  assert.match(imageSourceHelper, /const remainingMs = deadlineAt - Date\.now\(\)/);
  assert.match(imageSourceHelper, /setTimeout\(\(\) => resolve\(null\), remainingMs\)/);
  assert.match(imageSourceHelper, /return null;/);
  assert.doesNotMatch(imageSourceHelper, /source\.guaranteed/);
  assert.match(source, /CROP_IMAGE_PRELOAD_HARD_TIMEOUT_MS/);
  assert.match(source, /cropDetectiveImagePreloadCache\.delete\(url\)/);
});
