import { Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import crypto from 'crypto';
import { minigameRepository, streamerRepository, systemConfigRepository, userRepository } from '../repositories';
import { MinigameSession, MinigameType } from '../repositories/interfaces';
import { getPuzzleExcludedImageKeys, normalizePuzzleImageKey } from '../services/puzzleImageExclusionService';
import { listUserImageBlinds } from '../services/userImageBlindService';
import { normalizeImageBlindKey } from '../utils/imageBlindKey';
import { recordAchievementEvent } from '../services/achievementService';
import { createMinigameImageReference } from '../services/minigameImageToken';
import { ACTION_GAME_NAMES, ACTION_GAME_PLAY_MS, ACTION_GAMES, ActionGameError, ActionInput, ActionTarget,
  actionReward, advanceActionGame, createActionTarget, initialActionState, isActionGame,
  publicActionGame, readActionState } from '../services/actionMinigames';

const DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES = 240; // 4시간
const MAX_TICKETS = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAILY_MINIGAMES = ['quiz', 'match', ...ACTION_GAMES] as const;
const LEGACY_MINIGAMES = ['puzzle', 'value_duel', 'crop_detective'] as const;
const ALL_MINIGAMES: readonly string[] = [...DAILY_MINIGAMES, ...LEGACY_MINIGAMES];
const MINIGAME_VALIDATION_VERSION = 1;
// Capture before authentication/database work. A body/header cannot supply this timestamp.
export const markMinigameRequestTime: RequestHandler = (_req, res, next) => {
  res.locals.minigameReceivedAt = Date.now();
  next();
};
const minigameReceivedAt = (res: Response): number => res.locals?.minigameReceivedAt ?? Date.now();
const getSessionValidationVersion = (session: MinigameSession, target: any): number =>
  Math.floor(Number(session.validation_version ?? target?.validation_version ?? 0) || 0);
// Sessions issued before the authoritative protocol did not contain enough
// server-owned state to award points safely. They remain fail-closed forever.
const isLegacyUnverifiablePaidSession = (session: MinigameSession, target: any) =>
  target?.practice_mode !== true && getSessionValidationVersion(session, target) !== MINIGAME_VALIDATION_VERSION;
const COUNTDOWN_MS = 3_000;
const SUBMISSION_GRACE_MS = 2_000;
const CLIENT_REPORTED_GRACE_MS = 8_000;
const TERMINAL_SUCCESS_RETRY_GRACE_MS = Math.max(
  CLIENT_REPORTED_GRACE_MS,
  Number(process.env.MINIGAME_TERMINAL_SUCCESS_RETRY_GRACE_MS || 60_000)
);
const PUZZLE_TIME_LIMIT_MS = 120_000;
const PUZZLE_PIECE_COUNT = 12;
const PUZZLE_MAX_MOVES = 128;
const MATCH_REVEAL_MS = 2_000;
const MATCH_TIME_LIMIT_MS = 30_000;
const MATCH_PAIR_COUNT = 6;
const QUIZ_ROUND_COUNT = 5;
const QUIZ_CHOICES = 2;
const QUIZ_ROUND_TIME_MS = 10_000;
const QUIZ_MIN_CORRECT = 3;
const VALUE_DUEL_ROUND_COUNT = 5;
const VALUE_DUEL_ROUND_TIME_MS = 10_000;
const VALUE_DUEL_MIN_CORRECT = 3;
const CROP_DETECTIVE_ROUND_COUNT = 5;
const CROP_DETECTIVE_ROUND_TIME_MS = 10_000;
const CROP_DETECTIVE_MIN_CORRECT = 3;
const CROP_DETECTIVE_CHOICES = 4;
const CROP_DETECTIVE_EDGE_PADDING = 0.025;
const CROP_DETECTIVE_CARD_ASPECT_RATIO = 5 / 8;
const STARTED_SESSION_RECOVERY_MINUTES = 3;
const ROUND_GAME_SESSION_LIMIT_MS = STARTED_SESSION_RECOVERY_MINUTES * 60_000;
const MINIGAME_POOL_CACHE_TTL = Math.max(5_000, Number(process.env.MINIGAME_POOL_CACHE_TTL_MS || 60_000));
const MINIGAME_SESSION_EXPIRE_INTERVAL_MS = Math.max(30_000, Number(process.env.MINIGAME_SESSION_EXPIRE_INTERVAL_MS || 60_000));
const MINIGAME_SESSION_EXPIRE_BATCH_LIMIT = Math.max(10, Math.min(500, Number(process.env.MINIGAME_SESSION_EXPIRE_BATCH_LIMIT || 50)));
let minigamePoolCache: { data: any[]; expiresAt: number } | null = null;
let minigamePoolInFlight: Promise<any[]> | null = null;
let minigameSessionExpireInFlight: Promise<void> | null = null;
let minigameSessionExpireLastRunAt = 0;

type DailyMinigameType = MinigameType;

type RoundAnswer = {
  round: number;
  selected_channel_id: string;
};

type RoundScore = {
  valid: boolean;
  reason?: string;
  correctCount: number;
  totalRounds: number;
  selectedCount: number;
  perfect: boolean;
};

const formatKstDbTime = (dateMs = Date.now()): string => {
  const kst = new Date(dateMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
};

const parseDbKstTimeMs = (value: string | undefined | null): number => {
  if (!value) return NaN;
  const trimmed = String(value).trim();
  if (!trimmed) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed).getTime();
  const kst = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (kst) {
    const ms = kst[7] ? Number(kst[7].padEnd(3, '0').slice(0, 3)) : 0;
    return Date.UTC(Number(kst[1]), Number(kst[2]) - 1, Number(kst[3]), Number(kst[4]), Number(kst[5]), Number(kst[6]), ms) - KST_OFFSET_MS;
  }
  return new Date(trimmed).getTime();
};

const parseDbJson = <T = any>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const getGamePreplayMs = (gameType: DailyMinigameType): number => {
  if (gameType === 'match') return COUNTDOWN_MS + MATCH_REVEAL_MS;
  return COUNTDOWN_MS;
};

const scheduleMinigameSessionExpiry = (force = false): Promise<void> | null => {
  const now = Date.now();
  if (minigameSessionExpireInFlight) return minigameSessionExpireInFlight;
  if (!force && now - minigameSessionExpireLastRunAt < MINIGAME_SESSION_EXPIRE_INTERVAL_MS) return null;
  minigameSessionExpireLastRunAt = now;
  minigameSessionExpireInFlight = minigameRepository
    .expireSessions(STARTED_SESSION_RECOVERY_MINUTES, MINIGAME_SESSION_EXPIRE_BATCH_LIMIT)
    .catch((err) => {
      console.warn('[MinigameController] stale session cleanup failed:', err?.message || err);
    })
    .finally(() => {
      minigameSessionExpireInFlight = null;
    });
  return minigameSessionExpireInFlight;
};

const getGamePlayLimitMs = (gameType: DailyMinigameType): number => {
  if (isActionGame(gameType)) return ACTION_GAME_PLAY_MS[gameType];
  if (gameType === 'puzzle') return PUZZLE_TIME_LIMIT_MS;
  if (gameType === 'quiz' || gameType === 'value_duel' || gameType === 'crop_detective') return ROUND_GAME_SESSION_LIMIT_MS;
  return MATCH_TIME_LIMIT_MS;
};

const completedWithinBonusTime = (
  serverElapsedMs: number,
  gameType: DailyMinigameType,
  bonusPlayLimitMs: number
): boolean => {
  const serverBonusLimitMs = getGamePreplayMs(gameType) + bonusPlayLimitMs + SUBMISSION_GRACE_MS;
  return serverElapsedMs <= serverBonusLimitMs;
};

const getGameSubmitAllowanceMs = (gameType: DailyMinigameType): number =>
  getGamePreplayMs(gameType) + getGamePlayLimitMs(gameType) + SUBMISSION_GRACE_MS;

const getSessionTiming = (session: Pick<MinigameSession, 'game_type' | 'created_at'> & Partial<Pick<MinigameSession, 'target_data'>>) => {
  const nowMs = Date.now();
  const createdMs = parseDbKstTimeMs(session.created_at);
  const elapsedMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
  const skippedCountdown = parseDbJson<{ skip_countdown?: boolean }>(session.target_data, {}).skip_countdown === true ? COUNTDOWN_MS : 0;
  const preplayMs = getGamePreplayMs(session.game_type) - skippedCountdown;
  const playLimitMs = getGamePlayLimitMs(session.game_type);
  const playElapsedMs = Math.max(0, elapsedMs - preplayMs);
  const timeRemainingMs = Math.max(0, playLimitMs - playElapsedMs);

  return {
    server_now: new Date(nowMs).toISOString(),
    session_started_at: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    session_started_at_kst: Number.isFinite(createdMs) ? formatKstDbTime(createdMs) : null,
    server_elapsed_ms: elapsedMs,
    preplay_ms: preplayMs,
    time_limit_ms: playLimitMs,
    time_remaining_ms: timeRemainingMs,
    submit_allowance_ms: getGameSubmitAllowanceMs(session.game_type) - skippedCountdown
  };
};

const normalizeRotation = (rotation: unknown) => {
  const numeric = Number(rotation);
  if (!Number.isFinite(numeric)) return NaN;
  return ((Math.floor(numeric) % 360) + 360) % 360;
};

type PuzzlePieceState = { id: number; rotation: number };
type PuzzleMove =
  | { type: 'swap'; from: number; to: number }
  | { type: 'rotate'; index: number };
type MatchPairProof = { first_card_id: string; second_card_id: string };

const parsePuzzlePieces = (pieces: unknown): PuzzlePieceState[] | null => {
  if (!Array.isArray(pieces) || pieces.length !== PUZZLE_PIECE_COUNT) return null;
  const seen = new Set<number>();
  const parsed: PuzzlePieceState[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index] as any;
    const id = Number(piece?.id);
    const rotation = normalizeRotation(piece?.rotation);
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= PUZZLE_PIECE_COUNT ||
      seen.has(id) ||
      ![0, 90, 180, 270].includes(rotation)
    ) return null;
    seen.add(id);
    parsed.push({ id, rotation });
  }
  return seen.size === PUZZLE_PIECE_COUNT ? parsed : null;
};

const isPuzzleSolved = (pieces: PuzzlePieceState[]): boolean =>
  pieces.length === PUZZLE_PIECE_COUNT &&
  pieces.every((piece, index) => piece.id === index && piece.rotation === 0);

const isSolvedLegacyPuzzlePayload = (pieces: unknown): boolean => {
  const parsed = parsePuzzlePieces(pieces);
  return Boolean(parsed && isPuzzleSolved(parsed));
};

const createInitialPuzzlePieces = (): PuzzlePieceState[] => {
  const ids = Array.from({ length: PUZZLE_PIECE_COUNT }, (_, index) => index);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  if (ids.every((id, index) => id === index)) [ids[0], ids[5]] = [ids[5], ids[0]];

  const pieces = ids.map((id) => ({ id, rotation: crypto.randomInt(4) * 90 }));
  if (pieces.filter((piece) => piece.rotation !== 0).length < 3) {
    pieces[0] = { ...pieces[0], rotation: 90 };
    pieces[5] = { ...pieces[5], rotation: 180 };
    pieces[11] = { ...pieces[11], rotation: 270 };
  }
  return pieces;
};

const replayPuzzleMoves = (
  initialPieces: unknown,
  rawMoves: unknown,
  finalPieces: unknown
): { ok: true } | { ok: false; reason: string } => {
  const initial = parsePuzzlePieces(initialPieces);
  const submittedFinal = parsePuzzlePieces(finalPieces);
  if (!initial) return { ok: false, reason: '서버가 발급한 퍼즐 초기 상태가 올바르지 않습니다.' };
  if (!submittedFinal) return { ok: false, reason: '퍼즐 최종 상태가 올바르지 않습니다.' };
  if (!Array.isArray(rawMoves) || rawMoves.length === 0 || rawMoves.length > PUZZLE_MAX_MOVES) {
    return { ok: false, reason: `퍼즐 조작 기록은 1~${PUZZLE_MAX_MOVES}개여야 합니다.` };
  }

  const replayed = initial.map((piece) => ({ ...piece }));
  for (const rawMove of rawMoves) {
    const type = String((rawMove as any)?.type || '');
    if (type === 'swap') {
      const from = Number((rawMove as any)?.from);
      const to = Number((rawMove as any)?.to);
      if (
        !Number.isInteger(from) || !Number.isInteger(to) ||
        from < 0 || to < 0 || from >= PUZZLE_PIECE_COUNT || to >= PUZZLE_PIECE_COUNT || from === to
      ) return { ok: false, reason: '퍼즐 위치 교환 기록이 올바르지 않습니다.' };
      [replayed[from], replayed[to]] = [replayed[to], replayed[from]];
      continue;
    }
    if (type === 'rotate') {
      const index = Number((rawMove as any)?.index);
      if (!Number.isInteger(index) || index < 0 || index >= PUZZLE_PIECE_COUNT) {
        return { ok: false, reason: '퍼즐 회전 기록이 올바르지 않습니다.' };
      }
      replayed[index] = { ...replayed[index], rotation: normalizeRotation(replayed[index].rotation + 90) };
      continue;
    }
    return { ok: false, reason: '지원하지 않는 퍼즐 조작 기록입니다.' };
  }

  if (replayed.some((piece, index) => piece.id !== submittedFinal[index].id || piece.rotation !== submittedFinal[index].rotation)) {
    return { ok: false, reason: '퍼즐 조작 기록과 최종 상태가 일치하지 않습니다.' };
  }
  if (!isPuzzleSolved(replayed)) return { ok: false, reason: '퍼즐이 완성되지 않았습니다.' };
  return { ok: true };
};

const isSolvedLegacyMatchPayload = (payloadChannelIds: unknown, targetChannelIds: unknown): boolean => {
  if (!Array.isArray(payloadChannelIds) || !Array.isArray(targetChannelIds)) return false;
  const expected = targetChannelIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (expected.length === 0 || payloadChannelIds.length !== expected.length * 2) return false;

  const expectedCounts = new Map<string, number>();
  for (const id of expected) {
    expectedCounts.set(id, (expectedCounts.get(id) || 0) + 2);
  }

  const actualCounts = new Map<string, number>();
  for (const rawId of payloadChannelIds) {
    const id = String(rawId || '').trim();
    if (!id || !expectedCounts.has(id)) return false;
    actualCounts.set(id, (actualCounts.get(id) || 0) + 1);
  }

  for (const [id, count] of expectedCounts) {
    if (actualCounts.get(id) !== count) return false;
  }
  return actualCounts.size === expectedCounts.size;
};

const validateMatchPairProof = (
  rawPairs: unknown,
  targetCards: unknown
): { ok: true } | { ok: false; reason: string } => {
  if (!Array.isArray(targetCards) || targetCards.length !== MATCH_PAIR_COUNT * 2) {
    return { ok: false, reason: '서버가 발급한 짝맞추기 카드 상태가 올바르지 않습니다.' };
  }
  const cardsById = new Map<string, any>();
  const channelCounts = new Map<string, number>();
  for (const rawCard of targetCards) {
    const cardId = String((rawCard as any)?.card_id || '').trim();
    const channelId = String((rawCard as any)?.channel_id || '').trim();
    if (!cardId || !channelId || cardsById.has(cardId)) {
      return { ok: false, reason: '서버가 발급한 짝맞추기 카드가 중복되었거나 올바르지 않습니다.' };
    }
    cardsById.set(cardId, rawCard);
    channelCounts.set(channelId, (channelCounts.get(channelId) || 0) + 1);
  }
  if (channelCounts.size !== MATCH_PAIR_COUNT || [...channelCounts.values()].some((count) => count !== 2)) {
    return { ok: false, reason: '서버가 발급한 짝 구성이 올바르지 않습니다.' };
  }
  if (!Array.isArray(rawPairs) || rawPairs.length !== MATCH_PAIR_COUNT) {
    return { ok: false, reason: `완료된 짝은 정확히 ${MATCH_PAIR_COUNT}개여야 합니다.` };
  }

  const usedCardIds = new Set<string>();
  for (const rawPair of rawPairs as MatchPairProof[]) {
    const firstId = String(rawPair?.first_card_id || '').trim();
    const secondId = String(rawPair?.second_card_id || '').trim();
    const first = cardsById.get(firstId);
    const second = cardsById.get(secondId);
    if (!firstId || !secondId || firstId === secondId || !first || !second) {
      return { ok: false, reason: '짝맞추기 카드 식별자가 올바르지 않습니다.' };
    }
    if (usedCardIds.has(firstId) || usedCardIds.has(secondId)) {
      return { ok: false, reason: '같은 짝맞추기 카드를 두 번 사용할 수 없습니다.' };
    }
    if (String(first.channel_id) !== String(second.channel_id)) {
      return { ok: false, reason: '서로 다른 카드가 한 쌍으로 제출되었습니다.' };
    }
    usedCardIds.add(firstId);
    usedCardIds.add(secondId);
  }
  if (usedCardIds.size !== MATCH_PAIR_COUNT * 2) {
    return { ok: false, reason: '모든 짝맞추기 카드를 정확히 한 번씩 사용해야 합니다.' };
  }
  return { ok: true };
};

const getMatchTargetChannelIds = (target: any): string[] => {
  if (Array.isArray(target?.channel_ids)) {
    return target.channel_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean);
  }
  if (Array.isArray(target?.cards)) {
    return target.cards.map((card: any) => String(card?.channel_id || '').trim()).filter(Boolean);
  }
  return [];
};

const isRoundGameType = (gameType: string): gameType is 'quiz' | 'value_duel' | 'crop_detective' =>
  gameType === 'quiz' || gameType === 'value_duel' || gameType === 'crop_detective';

const getRoundTimeLimitMs = (gameType: string): number => {
  if (gameType === 'quiz') return QUIZ_ROUND_TIME_MS;
  if (gameType === 'value_duel') return VALUE_DUEL_ROUND_TIME_MS;
  if (gameType === 'crop_detective') return CROP_DETECTIVE_ROUND_TIME_MS;
  return 0;
};

const createRoundDeadline = (gameType: string, includeCountdown = false): string | null => {
  const roundTimeMs = getRoundTimeLimitMs(gameType);
  if (roundTimeMs <= 0) return null;
  return new Date(Date.now() + (includeCountdown ? COUNTDOWN_MS : 0) + roundTimeMs + SUBMISSION_GRACE_MS).toISOString();
};

const shuffle = <T>(items: T[]): T[] => [...items].sort(() => 0.5 - Math.random());

const toRoundAnswers = (rawAnswers: unknown): { ok: true; answers: RoundAnswer[] } | { ok: false; reason: string } => {
  if (!Array.isArray(rawAnswers)) return { ok: false, reason: '라운드 답안 목록이 올바르지 않습니다.' };
  const seen = new Set<number>();
  const answers: RoundAnswer[] = [];
  for (const raw of rawAnswers) {
    const round = Number((raw as any)?.round);
    const selected = String((raw as any)?.selected_channel_id || '').trim();
    if (!Number.isInteger(round) || round < 0) return { ok: false, reason: '라운드 번호가 올바르지 않습니다.' };
    if (seen.has(round)) return { ok: false, reason: '중복된 라운드 답안이 포함되어 있습니다.' };
    if (!selected) return { ok: false, reason: '선택한 스트리머 정보가 누락되었습니다.' };
    seen.add(round);
    answers.push({ round, selected_channel_id: selected });
  }
  return { ok: true, answers };
};

const getRoundAnswerMap = (answers: RoundAnswer[]) => {
  const map = new Map<number, string>();
  for (const answer of answers) map.set(answer.round, answer.selected_channel_id);
  return map;
};

const scoreQuizAnswers = (answers: RoundAnswer[], target: any): RoundScore => {
  const rounds = Array.isArray(target?.rounds) ? target.rounds : [];
  if (rounds.length !== QUIZ_ROUND_COUNT) {
    return { valid: false, reason: '인물 퀴즈 문제 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: QUIZ_ROUND_COUNT, selectedCount: 0, perfect: false };
  }
  const answerMap = getRoundAnswerMap(answers);
  let correctCount = 0;

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    const choices = Array.isArray(round?.choices) ? round.choices : [];
    const choiceIds = new Set(choices.map((choice: any) => String(choice?.channel_id || '').trim()).filter(Boolean));
    if (Number(round?.round) !== index || !round?.answer_channel_id || !round?.image_url || choiceIds.size !== QUIZ_CHOICES) {
      return { valid: false, reason: '인물 퀴즈 라운드 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    const selected = answerMap.get(index);
    if (!selected) continue;
    if (!choiceIds.has(selected)) {
      return { valid: false, reason: '보기 외 선택값이 포함되어 있습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    if (selected === round.answer_channel_id) correctCount += 1;
  }

  return {
    valid: true,
    correctCount,
    totalRounds: rounds.length,
    selectedCount: answerMap.size,
    perfect: correctCount === rounds.length
  };
};

const getValueDuelCorrectIds = (round: any): string[] => {
  const leftValue = Number(round?.left?.base_value);
  const rightValue = Number(round?.right?.base_value);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return [];
  if (leftValue === rightValue) return [round.left.channel_id, round.right.channel_id].filter(Boolean);
  return [leftValue > rightValue ? round.left?.channel_id : round.right?.channel_id].filter(Boolean);
};

const scoreValueDuelAnswers = (answers: RoundAnswer[], target: any): RoundScore => {
  const rounds = Array.isArray(target?.rounds) ? target.rounds : [];
  if (rounds.length !== VALUE_DUEL_ROUND_COUNT) {
    return { valid: false, reason: '시세 듀얼 문제 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: VALUE_DUEL_ROUND_COUNT, selectedCount: 0, perfect: false };
  }
  const answerMap = getRoundAnswerMap(answers);
  let correctCount = 0;

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    if (Number(round?.round) !== index || !round?.left?.channel_id || !round?.right?.channel_id) {
      return { valid: false, reason: '시세 듀얼 라운드 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    const selected = answerMap.get(index);
    if (!selected) continue;
    if (selected !== round.left.channel_id && selected !== round.right.channel_id) {
      return { valid: false, reason: '보기 외 선택값이 포함되어 있습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    if (getValueDuelCorrectIds(round).includes(selected)) correctCount += 1;
  }

  return {
    valid: true,
    correctCount,
    totalRounds: rounds.length,
    selectedCount: answerMap.size,
    perfect: correctCount === rounds.length
  };
};

const scoreCropDetectiveAnswers = (answers: RoundAnswer[], target: any): RoundScore => {
  const rounds = Array.isArray(target?.rounds) ? target.rounds : [];
  if (rounds.length !== CROP_DETECTIVE_ROUND_COUNT) {
    return { valid: false, reason: '카드 확대 탐정 문제 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: CROP_DETECTIVE_ROUND_COUNT, selectedCount: 0, perfect: false };
  }
  const answerMap = getRoundAnswerMap(answers);
  let correctCount = 0;

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    const choices = Array.isArray(round?.choices) ? round.choices : [];
    const choiceIds = new Set(choices.map((choice: any) => String(choice?.channel_id || '').trim()).filter(Boolean));
    if (Number(round?.round) !== index || !round?.answer_channel_id || choiceIds.size !== CROP_DETECTIVE_CHOICES) {
      return { valid: false, reason: '카드 확대 탐정 라운드 데이터가 올바르지 않습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    const selected = answerMap.get(index);
    if (!selected) continue;
    if (!choiceIds.has(selected)) {
      return { valid: false, reason: '보기 외 선택값이 포함되어 있습니다.', correctCount: 0, totalRounds: rounds.length, selectedCount: answerMap.size, perfect: false };
    }
    if (selected === round.answer_channel_id) correctCount += 1;
  }

  return {
    valid: true,
    correctCount,
    totalRounds: rounds.length,
    selectedCount: answerMap.size,
    perfect: correctCount === rounds.length
  };
};

const scoreRoundGameAnswers = (gameType: string, answers: RoundAnswer[], target: any): RoundScore => {
  if (gameType === 'quiz') return scoreQuizAnswers(answers, target);
  if (gameType === 'value_duel') return scoreValueDuelAnswers(answers, target);
  if (gameType === 'crop_detective') return scoreCropDetectiveAnswers(answers, target);
  return { valid: false, reason: '라운드형 미니게임이 아닙니다.', correctCount: 0, totalRounds: 0, selectedCount: 0, perfect: false };
};

type StoredRoundOutcome = {
  round: number;
  selected_channel_id: string | null;
};

const getStoredRoundOutcomes = (session: MinigameSession): StoredRoundOutcome[] => {
  const progress = parseDbJson<any>(session.progress_data, {});
  if (!Array.isArray(progress?.round_outcomes)) return [];
  const outcomes: StoredRoundOutcome[] = [];
  for (let index = 0; index < progress.round_outcomes.length; index += 1) {
    const raw = progress.round_outcomes[index];
    const round = Number(raw?.round);
    const selectedRaw = raw?.selected_channel_id;
    const selected = selectedRaw == null ? null : String(selectedRaw).trim();
    if (round !== index || (selectedRaw != null && !selected)) return [];
    outcomes.push({ round, selected_channel_id: selected });
  }
  return outcomes;
};

const getStoredRoundDeadline = (session: MinigameSession): string | null => {
  const progress = parseDbJson<any>(session.progress_data, {});
  if (session.game_type === 'crop_detective') {
    const outcomes = Array.isArray(progress?.round_outcomes) ? progress.round_outcomes : [];
    if (progress?.round_image_armed_round !== outcomes.length) return null;
  }
  if (
    session.game_type === 'value_duel' &&
    Object.prototype.hasOwnProperty.call(progress, 'round_started_round')
  ) {
    const outcomes = Array.isArray(progress?.round_outcomes) ? progress.round_outcomes : [];
    if (progress?.round_started_round !== outcomes.length) return null;
  }
  const rawDeadline = String(progress?.round_deadline_at || '').trim();
  return rawDeadline && Number.isFinite(new Date(rawDeadline).getTime()) ? rawDeadline : null;
};

const getRoundAnswersFromOutcomes = (outcomes: StoredRoundOutcome[]): RoundAnswer[] =>
  outcomes.flatMap((outcome) => outcome.selected_channel_id
    ? [{ round: outcome.round, selected_channel_id: outcome.selected_channel_id }]
    : []);

const parseStoredResultData = (value: unknown): Record<string, any> | null => {
  const result = parseDbJson<Record<string, any> | null>(value, null);
  return result && typeof result === 'object' ? result : null;
};

const getStoredResult = (session: MinigameSession): Record<string, any> | null =>
  parseStoredResultData(session.result_data);

async function getTicketChargeIntervalMinutes(): Promise<number> {
  const value = await systemConfigRepository.get(
    'minigame_ticket_charge_interval_minutes',
    String(DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES)
  );
  const minutes = parseInt(value, 10);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES;
}

export function getDailyMinigame(nowMs = Date.now()): {
  game_type: DailyMinigameType;
  kst_date: string;
  next_game_at: string;
  seconds_until_game_change: number;
} {
  const kstNow = new Date(nowMs + KST_OFFSET_MS);
  const year = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth();
  const date = kstNow.getUTCDate();
  const kstDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const nextMidnightUtcMs = Date.UTC(year, month, date + 1) - KST_OFFSET_MS;
  const digest = crypto.createHash('sha256').update(`chikapo-daily-minigame:${kstDate}`).digest();
  const gameType = DAILY_MINIGAMES[digest.readUInt32BE(0) % DAILY_MINIGAMES.length];

  return {
    game_type: gameType,
    kst_date: kstDate,
    next_game_at: new Date(nextMidnightUtcMs).toISOString(),
    seconds_until_game_change: Math.max(0, Math.ceil((nextMidnightUtcMs - nowMs) / 1000))
  };
}

// 스트리머 카드 이미지 경로 결정 함수 (프론트와 동치)
export function getCardImageUrl(streamer: any, star: number): string {
  const images = streamer.custom_images && streamer.custom_images.length
    ? streamer.custom_images
    : [streamer.custom_image_url ?? null];
  const safeStar = Math.max(0, Math.min(5, Math.floor(Number(star) || 0)));
  for (let currentStar = safeStar; currentStar >= 0; currentStar--) {
    if (images[currentStar]) {
      return images[currentStar];
    }
  }
  return streamer.logo_url || '';
}

const getDistinctFallbackImageUrl = (
  imageUrl: string | null | undefined,
  fallbackImageUrl: string | null | undefined
): string | null => {
  const primary = String(imageUrl || '').trim();
  const fallback = String(fallbackImageUrl || '').trim();
  return fallback && fallback !== primary ? fallback : null;
};

const loadMinigamePool = async (): Promise<any[]> => {
  const now = Date.now();
  if (minigamePoolCache && minigamePoolCache.expiresAt > now) {
    return minigamePoolCache.data;
  }
  if (minigamePoolInFlight) return minigamePoolInFlight;

  minigamePoolInFlight = streamerRepository.findAll()
    .then((streamers) => {
      minigamePoolCache = { data: streamers, expiresAt: Date.now() + MINIGAME_POOL_CACHE_TTL };
      return streamers;
    })
    .finally(() => {
      minigamePoolInFlight = null;
    });

  return minigamePoolInFlight;
};

const buildCardOption = (streamer: any, star: number) => {
  const imageUrl = getCardImageUrl(streamer, star);
  return {
    channel_id: streamer.channel_id,
    name: streamer.name,
    image_url: imageUrl,
    fallback_image_url: getDistinctFallbackImageUrl(imageUrl, streamer.logo_url),
    star
  };
};

const buildValuedCardOption = (streamer: any, star: number) => ({
  ...buildCardOption(streamer, star),
  base_value: Number(streamer.base_value || 0)
});

const stripCardValue = (card: any) => ({
  channel_id: card.channel_id,
  name: card.name,
  image_url: card.image_url,
  fallback_image_url: getDistinctFallbackImageUrl(card.image_url, card.fallback_image_url),
  star: Number(card.star) || 0
});

const buildPublicRound = (gameType: string, rawRound: any, sessionId: string, userId: string): any | null => {
  const round = Number(rawRound?.round);
  if (!Number.isInteger(round) || round < 0 || !sessionId || !userId) return null;

  if (gameType === 'quiz') {
    const imageUrl = String(rawRound?.image_url || '').trim();
    const choices = Array.isArray(rawRound?.choices)
      ? rawRound.choices.map((choice: any) => ({
        channel_id: String(choice?.channel_id || '').trim(),
        name: String(choice?.name || '').trim()
      }))
      : [];
    if (!imageUrl || choices.length !== QUIZ_CHOICES || choices.some((choice: any) => !choice.channel_id || !choice.name)) return null;
    try {
      return {
        round,
        image_url: createMinigameImageReference({
          userId,
          sessionId,
          round,
          sourceUrl: imageUrl,
          kind: 'quiz'
        }),
        choices
      };
    } catch {
      return null;
    }
  }

  if (gameType === 'value_duel') {
    const left = stripCardValue(rawRound?.left || {});
    const right = stripCardValue(rawRound?.right || {});
    if (!left.channel_id || !right.channel_id || left.channel_id === right.channel_id) return null;
    return { round, left, right };
  }

  if (gameType === 'crop_detective') {
    const crop = rawRound?.crop || {};
    const rotation = normalizeRotation(crop.rotation ?? 0);
    const x = Number(crop.x);
    const y = Number(crop.y);
    const size = Number(crop.size);
    const sourceImageUrl = String(rawRound?.source_image_url || '').trim();
    const choices = Array.isArray(rawRound?.choices) ? rawRound.choices.map(stripCardValue) : [];
    if (
      !sourceImageUrl || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(size) || !Number.isFinite(rotation) ||
      choices.length !== CROP_DETECTIVE_CHOICES || choices.some((choice: any) => !choice.channel_id)
    ) return null;
    try {
      const protectedCrop = { x, y, size, rotation };
      const sourceImageReference = createMinigameImageReference({
        userId,
        sessionId,
        round,
        sourceUrl: sourceImageUrl,
        kind: 'crop',
        crop: protectedCrop
      });
      return {
        round,
        source_image_url: sourceImageReference,
        // The real crop geometry is encrypted into the image reference. The
        // browser receives only the already-rendered square clue.
        crop: { x: 0.5, y: 0.5, size: 1, rotation: 0 },
        choices
      };
    } catch {
      return null;
    }
  }

  return null;
};

const isUserBlindedMinigameImage = (imageUrl: string | null | undefined, imageBlindKeys: Set<string>): boolean => {
  if (!imageBlindKeys.size) return false;
  const imageKey = normalizeImageBlindKey(imageUrl);
  return Boolean(imageKey && imageBlindKeys.has(imageKey));
};

const loadUserImageBlindKeys = async (userId: string): Promise<Set<string>> => {
  try {
    const items = await listUserImageBlinds(userId);
    return new Set(items.map((item) => item.image_key).filter(Boolean));
  } catch (err: any) {
    console.warn('[MinigameController] 개인 블라인드 이미지 목록 조회 실패, 필터 없이 진행합니다:', err?.message || err);
    return new Set<string>();
  }
};

const getPlayableImageCards = (streamers: any[], imageBlindKeys = new Set<string>()) =>
  streamers.flatMap((streamer) =>
    Array.from({ length: 6 }, (_, star) => {
      const imageUrl = getCardImageUrl(streamer, star);
      if (!imageUrl || isUserBlindedMinigameImage(imageUrl, imageBlindKeys)) return null;
      return {
        streamer,
        card: {
          channel_id: streamer.channel_id,
          name: streamer.name,
          image_url: imageUrl,
          fallback_image_url: getDistinctFallbackImageUrl(imageUrl, streamer.logo_url),
          star,
          base_value: Number(streamer.base_value || 0)
        }
      };
    }).filter(Boolean) as Array<{ streamer: any; card: any }>
  );

const getUniquePlayableImageCards = (streamers: any[], imageBlindKeys = new Set<string>()) => {
  const byChannel = new Map<string, any[]>();
  for (const item of getPlayableImageCards(streamers, imageBlindKeys)) {
    const channelId = item.card.channel_id;
    if (!channelId) continue;
    const cards = byChannel.get(channelId) || [];
    cards.push(item.card);
    byChannel.set(channelId, cards);
  }
  return Array.from(byChannel.values()).map((cards) => shuffle(cards)[0]);
};

const getRotatedCropHalfExtent = (size: number, rotation: number) => {
  const radians = (rotation * Math.PI) / 180;
  return (size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))) / 2;
};

const getCropDetectiveBounds = (size: number, rotation: number) => {
  // Crop coordinates are normalized against the same 5:8 card viewport shown to players.
  // `size` is relative to the viewport width, so a square crop occupies less normalized
  // height than width on the portrait canvas.
  const horizontalHalfExtent = getRotatedCropHalfExtent(size, rotation);
  const verticalHalfExtent = horizontalHalfExtent * CROP_DETECTIVE_CARD_ASPECT_RATIO;
  return {
    minX: Math.min(0.5, horizontalHalfExtent + CROP_DETECTIVE_EDGE_PADDING),
    maxX: Math.max(0.5, 1 - horizontalHalfExtent - CROP_DETECTIVE_EDGE_PADDING),
    minY: Math.min(0.5, verticalHalfExtent + CROP_DETECTIVE_EDGE_PADDING),
    maxY: Math.max(0.5, 1 - verticalHalfExtent - CROP_DETECTIVE_EDGE_PADDING)
  };
};

const isPastStartedSessionRecoveryCutoff = (session: Pick<MinigameSession, 'created_at'>) => {
  const createdMs = parseDbKstTimeMs(session.created_at);
  if (!Number.isFinite(createdMs)) return true;
  return Date.now() - createdMs >= STARTED_SESSION_RECOVERY_MINUTES * 60_000;
};

const buildCrop = (roundIndex: number) => {
  const minSize = 0.05;
  const maxSize = 0.10;
  const size = Number((maxSize - (roundIndex / Math.max(1, CROP_DETECTIVE_ROUND_COUNT - 1)) * (maxSize - minSize)).toFixed(3));
  const rotation = Math.floor(Math.random() * 360);
  const bounds = getCropDetectiveBounds(size, rotation);
  const pick = (min: number, max: number) => {
    if (max <= min) return 0.5;
    return Number((min + Math.random() * (max - min)).toFixed(3));
  };
  return {
    x: pick(bounds.minX, bounds.maxX),
    y: pick(bounds.minY, bounds.maxY),
    size,
    rotation
  };
};

const buildPublicCropDetectiveGameData = (session: MinigameSession) => {
  if (session.game_type !== 'crop_detective') return null;
  const target = parseDbJson<any>(session.target_data, {});
  const validation = scoreCropDetectiveAnswers([], target);
  if (!validation.valid || !Array.isArray(target.rounds)) return null;

  const rounds = target.rounds.map((round: any, index: number) =>
    Number(round?.round) === index ? buildPublicRound('crop_detective', round, session.id, session.user_id) : null
  );

  if (rounds.some((round: any) => !round)) return null;
  const outcomes = getStoredRoundOutcomes(session);
  const visibleRoundCount = target.practice_mode === true
    ? rounds.length
    : Math.min(rounds.length, Math.max(1, outcomes.length + 1));
  return {
    rounds: rounds.slice(0, visibleRoundCount),
    total_rounds: rounds.length
  };
};

const buildCropDetectiveResumePayload = (session: MinigameSession) => {
  // Repository cleanup expires STARTED sessions at this exact cutoff. Keep the
  // resume window aligned so a session cannot be returned while cleanup expires it.
  if (isPastStartedSessionRecoveryCutoff(session)) return null;
  const timing = getSessionTiming(session);
  if (timing.time_remaining_ms <= 0) return null;
  const gameData = buildPublicCropDetectiveGameData(session);
  if (!gameData) return null;
  const target = parseDbJson<any>(session.target_data, {});
  const outcomes = getStoredRoundOutcomes(session);
  const score = scoreCropDetectiveAnswers(getRoundAnswersFromOutcomes(outcomes), target);
  return {
    session_id: session.id,
    game_type: 'crop_detective' as const,
    practice_mode: target.practice_mode === true,
    game_data: gameData,
    round_progress: {
      outcomes,
      next_round: outcomes.length,
      correct_count: score.valid ? score.correctCount : 0,
      total_rounds: Array.isArray(target?.rounds) ? target.rounds.length : 0,
      round_deadline_at: getStoredRoundDeadline(session)
    },
    resumed_session: true,
    interrupted_session_closed: false,
    message: '진행 중이던 카드 확대 탐정 세션을 이어서 시작합니다.',
    timing
  };
};

type MinigameAnswerReveal = {
  channel_id: string;
  name: string;
  image_url: string;
  star: number;
};

async function getAnswerReveal(
  gameType: string,
  target: any
): Promise<MinigameAnswerReveal | undefined> {
  if (gameType !== 'puzzle' || !target.correct_id) return undefined;

  if (target.correct_name && target.image_url) {
    return {
      channel_id: target.correct_id,
      name: target.correct_name,
      image_url: target.image_url,
      star: Number(target.star) || 0
    };
  }

  const streamer = await streamerRepository.findById(target.correct_id);
  if (!streamer) return undefined;

  return {
    channel_id: streamer.channel_id,
    name: streamer.name,
    image_url: getCardImageUrl(streamer, Number(target.star) || 0),
    star: Number(target.star) || 0
  };
}

// 1. GET /api/minigames/status
export const getMinigameStatus = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    const chargeIntervalMinutes = await getTicketChargeIntervalMinutes();
    const refreshed = await minigameRepository.refreshTicketStatus(userId, chargeIntervalMinutes);
    const dailyMinigame = getDailyMinigame();

    return res.status(200).json({
      current_tickets: refreshed.current_tickets + refreshed.bonus_tickets,
      base_tickets: refreshed.current_tickets,
      bonus_tickets: refreshed.bonus_tickets,
      max_tickets: MAX_TICKETS,
      seconds_until_next_ticket: refreshed.seconds_until_next_ticket,
      ticket_charge_interval_minutes: chargeIntervalMinutes,
      last_charged_at: refreshed.last_charged_at,
      today_game: dailyMinigame.game_type,
      kst_date: dailyMinigame.kst_date,
      next_game_at: dailyMinigame.next_game_at,
      seconds_until_game_change: dailyMinigame.seconds_until_game_change
    });
  } catch (err: any) {
    console.error('[MinigameController] status error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '티켓 상태 조회에 실패했습니다.' });
  }
};

// GET /api/minigames/active?game_type=crop_detective
export const getActiveMinigameSession = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const gameType = String(req.query?.game_type || 'crop_detective');
  if (gameType !== 'crop_detective') {
    return res.status(400).json({ error: 'BadRequest', message: '복구를 지원하지 않는 미니게임입니다.' });
  }

  try {
    scheduleMinigameSessionExpiry();
    const activeSession = await minigameRepository.findActiveStartedSession(userId, 'crop_detective');
    if (!activeSession) return res.status(200).json({ active_session: null });
    const activeTarget = parseDbJson<any>(activeSession.target_data, {});
    if (isLegacyUnverifiablePaidSession(activeSession, activeTarget)) {
      const closeResult = await minigameRepository.completeSession(activeSession.id, 0);
      if (!closeResult.ok) {
        return res.status(409).json({
          error: 'ActiveSessionCloseFailed',
          message: '기존 보상형 미니게임 세션을 안전하게 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        });
      }
      return res.status(200).json({
        active_session: null,
        legacy_session_closed: true,
        message: '이전 검증 방식의 미니게임 세션을 안전하게 종료했습니다. 새 게임을 시작해 주세요.'
      });
    }
    const activePayload = buildCropDetectiveResumePayload(activeSession);
    if (activePayload) return res.status(200).json({ active_session: activePayload });

    const timing = getSessionTiming(activeSession);
    if (isPastStartedSessionRecoveryCutoff(activeSession) || timing.time_remaining_ms <= 0) {
      await minigameRepository.expireSessions(STARTED_SESSION_RECOVERY_MINUTES, MINIGAME_SESSION_EXPIRE_BATCH_LIMIT);
    }
    return res.status(200).json({ active_session: null });
  } catch (err: any) {
    console.error('[MinigameController] active session error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '진행 중인 미니게임을 확인하지 못했습니다.' });
  }
};

// POST /api/minigames/abandon
export const abandonMinigameSession = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const sessionId = String(req.body?.session_id || '').trim();
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  if (!sessionId) return res.status(400).json({ error: 'BadRequest', message: '미니게임 세션 정보가 필요합니다.' });

  try {
    const session = await minigameRepository.findSessionById(sessionId);
    if (!session) return res.status(404).json({ error: 'NotFound', message: '미니게임 세션을 찾을 수 없습니다.' });
    if (session.user_id !== userId) return res.status(403).json({ error: 'Forbidden', message: '잘못된 세션 소유권입니다.' });
    if (session.status !== 'STARTED') {
      return res.status(200).json({ abandoned: false, message: '이미 종료된 미니게임입니다.' });
    }
    const result = await minigameRepository.completeSession(sessionId, 0);
    if (!result.ok) {
      return res.status(409).json({ error: 'SessionCloseFailed', message: result.reason || '미니게임을 포기하지 못했습니다.' });
    }
    return res.status(200).json({ abandoned: true, message: '미니게임을 포기했습니다.' });
  } catch (err: any) {
    console.error('[MinigameController] abandon session error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '미니게임 포기 처리에 실패했습니다.' });
  }
};

// 2. POST /api/minigames/start
export const startMinigame = async (req: AuthenticatedRequest, res: Response) => {
  const receivedAt = minigameReceivedAt(res);
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { game_type, practice_mode } = req.body;
  const practiceMode = practice_mode === true;
  if (!ALL_MINIGAMES.includes(game_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 게임 타입입니다.' });
  }
  // 연습 모드 한정 테스트용 강제 지정: 특정 스트리머(channel)와 특정 별(0~5성) 이미지를 사용합니다.
  // (일반 게임에서는 무시 — 무작위성/공정성을 해치지 않도록 연습 모드에서만 적용)
  const forceChannelId = practiceMode && typeof req.body.force_channel_id === 'string'
    ? req.body.force_channel_id.trim()
    : '';
  const forceStar = practiceMode
    && req.body.force_star !== undefined && req.body.force_star !== null && req.body.force_star !== ''
    && Number.isFinite(Number(req.body.force_star))
    ? Math.max(0, Math.min(5, Math.floor(Number(req.body.force_star))))
    : null;
  const forceImageUrl = practiceMode
    && game_type === 'puzzle'
    && typeof req.body.force_image_url === 'string'
    && req.body.force_image_url.trim().length > 0
    && req.body.force_image_url.trim().length <= 2048
    ? req.body.force_image_url.trim()
    : '';

  try {
    const dailyMinigame = getDailyMinigame();
    let interruptedSessionClosed = false;
    let chargeIntervalMinutes = DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES;
    if (!practiceMode && game_type !== dailyMinigame.game_type) {
      return res.status(409).json({
        error: 'DailyMinigameChanged',
        message: '오늘 플레이할 수 있는 미니게임이 변경되었습니다. 오늘의 미니게임을 다시 확인해 주세요.',
        today_game: dailyMinigame.game_type,
        kst_date: dailyMinigame.kst_date,
        next_game_at: dailyMinigame.next_game_at
      });
    }

    if (!practiceMode) {
      scheduleMinigameSessionExpiry();

      const activeSession = await minigameRepository.findActiveStartedSession(userId, game_type as DailyMinigameType);
      if (activeSession) {
        const activeTarget = parseDbJson<any>(activeSession.target_data, {});
        if (isLegacyUnverifiablePaidSession(activeSession, activeTarget)) {
          const closeResult = await minigameRepository.completeSession(activeSession.id, 0);
          if (!closeResult.ok) {
            return res.status(409).json({
              error: 'ActiveSessionCloseFailed',
              message: '이전 미니게임 세션을 안전하게 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            });
          }
          interruptedSessionClosed = true;
        } else if (isActionGame(game_type)) {
          if (activeSession.expires_at && new Date(activeSession.expires_at).getTime() > Date.now()) {
            const action = readActionState(activeSession.progress_data);
            return res.status(200).json({ session_id: activeSession.id, game_type, practice_mode: false,
              resumed_session: true, game_data: publicActionGame(game_type, activeTarget, action, activeSession.progress_revision ?? 0, Date.now(), receivedAt) });
          }
          await minigameRepository.completeSession(activeSession.id, 0);
        } else if (game_type === 'crop_detective') {
          const resumePayload = buildCropDetectiveResumePayload(activeSession);
          if (resumePayload) return res.status(200).json(resumePayload);

          const timing = getSessionTiming(activeSession);
          if (isPastStartedSessionRecoveryCutoff(activeSession) || timing.time_remaining_ms <= 0) {
            await minigameRepository.expireSessions(STARTED_SESSION_RECOVERY_MINUTES, MINIGAME_SESSION_EXPIRE_BATCH_LIMIT);
          } else {
            const closeResult = await minigameRepository.completeSession(activeSession.id, 0);
            if (!closeResult.ok) {
              console.warn('[MinigameController] malformed active session close failed:', closeResult.reason);
              return res.status(409).json({
                error: 'ActiveSessionCloseFailed',
                message: '이전 미니게임 세션을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
              });
            }
            interruptedSessionClosed = true;
          }
        } else {
          const closeResult = await minigameRepository.completeSession(activeSession.id, 0);
          if (!closeResult.ok) {
            console.warn('[MinigameController] interrupted active session close failed:', closeResult.reason);
            return res.status(409).json({
              error: 'ActiveSessionCloseFailed',
              message: '이전 미니게임 세션을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            });
          }
          interruptedSessionClosed = true;
        }
      }

      // 일반 게임만 티켓 정보 조회 및 dynamic 충전을 반영합니다.
      chargeIntervalMinutes = await getTicketChargeIntervalMinutes();
      const refreshed = await minigameRepository.refreshTicketStatus(userId, chargeIntervalMinutes);

      if (refreshed.current_tickets + refreshed.bonus_tickets <= 0) {
        return res.status(403).json({ error: 'Forbidden', message: '사용 가능한 미니게임 티켓이 부족합니다.' });
      }
    }

    // 2. 문제 은행 데이터 가져오기
    const streamers = await loadMinigamePool();
    if (streamers.length < 4) {
      return res.status(400).json({ error: 'BadRequest', message: '등록된 스트리머가 부족하여 미니게임을 시작할 수 없습니다. (최소 4명 필요)' });
    }
    const userImageBlindKeys = await loadUserImageBlindKeys(userId);

    // 연습 모드 강제 지정 스트리머 해석
    const forcedStreamer = forceChannelId ? streamers.find(s => s.channel_id === forceChannelId) : null;
    if (forceChannelId && !forcedStreamer) {
      return res.status(404).json({ error: 'NotFound', message: '지정한 스트리머(channel_id)를 찾을 수 없습니다.' });
    }

    const sessionId = crypto.randomUUID();
    let gameData: any = {};
    let targetData: any = {};

    if (isActionGame(game_type)) {
      targetData = createActionTarget(game_type, getUniquePlayableImageCards(streamers, userImageBlindKeys));
      gameData = publicActionGame(game_type, targetData as ActionTarget, initialActionState(), 0);
    } else if (game_type === 'quiz') {
      const quizCandidates = getPlayableImageCards(streamers, userImageBlindKeys)
        .filter((item) => forceStar === null || item.card.star === forceStar);
      const forcedQuizCandidates = forcedStreamer
        ? quizCandidates.filter((item) => item.card.channel_id === forcedStreamer.channel_id)
        : [];
      if (quizCandidates.length === 0 || (forcedStreamer && forcedQuizCandidates.length === 0)) {
        return res.status(400).json({ error: 'BadRequest', message: '출제 가능한 인물 퀴즈 이미지가 없습니다. 블라인드 해제 후 다시 시도해 주세요.' });
      }
      const answerPool = forcedStreamer
        ? [...shuffle(forcedQuizCandidates), ...shuffle(quizCandidates.filter((item) => item.card.channel_id !== forcedStreamer.channel_id))]
        : shuffle(quizCandidates);
      const rounds = Array.from({ length: QUIZ_ROUND_COUNT }, (_, roundIndex) => {
        const correctCard = answerPool[roundIndex % answerPool.length].card;
        const distractor = shuffle(streamers)
          .find(s => s.channel_id !== correctCard.channel_id);
        const choices = shuffle([
          { channel_id: correctCard.channel_id, name: correctCard.name },
          ...(distractor ? [{ channel_id: distractor.channel_id, name: distractor.name }] : [])
        ]);
        return {
          round: roundIndex,
          answer_channel_id: correctCard.channel_id,
          answer_name: correctCard.name,
          image_url: correctCard.image_url,
          star: correctCard.star,
          choices
        };
      });

      targetData = { rounds };

      gameData = {
        rounds: rounds.map((round) => ({
          round: round.round,
          image_url: round.image_url,
          choices: round.choices
        }))
      };

    } else if (game_type === 'puzzle') {
      // 카드 퍼즐: 가로 3칸 세로 4칸 (정사각형 조각)
      let correctStreamer = forcedStreamer || streamers[Math.floor(Math.random() * streamers.length)];
      let star = forceStar !== null ? forceStar : Math.floor(Math.random() * 6);
      let imageUrl = forceImageUrl || getCardImageUrl(correctStreamer, star);

      if (forceImageUrl && isUserBlindedMinigameImage(forceImageUrl, userImageBlindKeys)) {
        return res.status(400).json({ error: 'BadRequest', message: '개인 블라인드한 이미지는 미니게임에 출제할 수 없습니다.' });
      }

      if (!forceImageUrl) {
        const excludedImageKeys = !practiceMode
          ? await getPuzzleExcludedImageKeys().catch((err) => {
            console.warn('[MinigameController] 퍼즐 제외 이미지 목록 조회 실패, 필터 없이 진행합니다:', err?.message || err);
            return new Set<string>();
          })
          : new Set<string>();
        const candidates = getPlayableImageCards(streamers, userImageBlindKeys)
          .filter((item) => {
            if (forcedStreamer && item.card.channel_id !== forcedStreamer.channel_id) return false;
            if (forceStar !== null && item.card.star !== forceStar) return false;
            const imageKey = normalizePuzzleImageKey(item.card.image_url);
            return !imageKey || !excludedImageKeys.has(imageKey);
          })
          .map((item) => ({ streamer: item.streamer, star: item.card.star, imageUrl: item.card.image_url }));

        if (candidates.length === 0) {
          return res.status(400).json({ error: 'BadRequest', message: '출제 가능한 3x4 퍼즐 이미지가 없습니다. 블라인드 해제 후 다시 시도해 주세요.' });
        }

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        correctStreamer = chosen.streamer;
        star = chosen.star;
        imageUrl = chosen.imageUrl;
      }

      targetData = {
        correct_id: correctStreamer.channel_id,
        correct_name: correctStreamer.name,
        image_url: imageUrl,
        star: star,
        initial_puzzle_pieces: createInitialPuzzlePieces()
      };

      gameData = {
        image_url: imageUrl,
        puzzle_pieces: targetData.initial_puzzle_pieces
      };

    } else if (game_type === 'match') {
      // 카드 뒤집기: 6명 선정 (12장). 강제 지정 스트리머가 있으면 반드시 포함.
      const matchStreamers = streamers.filter((streamer) => !isUserBlindedMinigameImage(streamer.logo_url, userImageBlindKeys));
      if (forcedStreamer && isUserBlindedMinigameImage(forcedStreamer.logo_url, userImageBlindKeys)) {
        return res.status(400).json({ error: 'BadRequest', message: '개인 블라인드한 이미지는 미니게임에 출제할 수 없습니다.' });
      }
      if (matchStreamers.length < 6) {
        return res.status(400).json({ error: 'BadRequest', message: '출제 가능한 짝맞추기 이미지가 부족합니다. 블라인드 해제 후 다시 시도해 주세요.' });
      }
      const pool = shuffle(matchStreamers);
      let chosen = pool.slice(0, 6);
      if (forcedStreamer && !chosen.some(s => s.channel_id === forcedStreamer.channel_id)) {
        chosen = [forcedStreamer, ...pool.filter(s => s.channel_id !== forcedStreamer.channel_id).slice(0, 5)];
      }

      const deck = shuffle(chosen.flatMap((streamer) => [0, 1].map(() => ({
        card_id: crypto.randomUUID(),
        channel_id: streamer.channel_id,
        name: streamer.name,
        logo_url: streamer.logo_url
      }))));

      targetData = {
        channel_ids: chosen.map(s => s.channel_id),
        cards: deck.map(card => ({
          card_id: card.card_id,
          channel_id: card.channel_id,
          name: card.name,
          logo_url: card.logo_url
        }))
      };

      gameData = {
        cards: deck.map(card => ({
          card_id: card.card_id,
          channel_id: card.channel_id,
          name: card.name,
          logo_url: card.logo_url
        }))
      };
    } else if (game_type === 'value_duel') {
      const candidates = getUniquePlayableImageCards(streamers, userImageBlindKeys)
        .filter((card) => Number.isFinite(Number(card.base_value)));
      if (candidates.length < 2) {
        return res.status(400).json({ error: 'BadRequest', message: '출제 가능한 시세 듀얼 카드가 부족합니다. (최소 2명 필요)' });
      }

      const rounds = Array.from({ length: VALUE_DUEL_ROUND_COUNT }, (_, roundIndex) => {
        const pool = shuffle(candidates);
        const left = pool[0];
        const right = pool.find((card) => card.channel_id !== left.channel_id) || pool[1];
        return {
          round: roundIndex,
          left,
          right
        };
      });

      targetData = { rounds };
      gameData = {
        rounds: rounds.map((round) => ({
          round: round.round,
          left: stripCardValue(round.left),
          right: stripCardValue(round.right)
        }))
      };
    } else if (game_type === 'crop_detective') {
      const candidates = getUniquePlayableImageCards(streamers, userImageBlindKeys);
      if (candidates.length < CROP_DETECTIVE_CHOICES) {
        return res.status(400).json({ error: 'BadRequest', message: '출제 가능한 카드 확대 탐정 이미지가 부족합니다. (최소 4명 필요)' });
      }

      const answerPool = shuffle(candidates);
      const rounds = Array.from({ length: CROP_DETECTIVE_ROUND_COUNT }, (_, roundIndex) => {
        const answer = answerPool[roundIndex % answerPool.length];
        const distractors = shuffle(candidates)
          .filter((card) => card.channel_id !== answer.channel_id)
          .slice(0, CROP_DETECTIVE_CHOICES - 1);
        const choices = shuffle([answer, ...distractors]).map(stripCardValue);
        return {
          round: roundIndex,
          answer_channel_id: answer.channel_id,
          source_image_url: answer.image_url,
          source_fallback_image_url: answer.fallback_image_url,
          crop: buildCrop(roundIndex),
          choices
        };
      });

      targetData = { rounds };
      gameData = {
        rounds: rounds.map((round) => ({
          round: round.round,
          crop: round.crop,
          source_image_url: round.source_image_url,
          source_fallback_image_url: round.source_fallback_image_url,
          choices: round.choices
        }))
      };
    }

    targetData.practice_mode = practiceMode;
    targetData.skip_countdown = req.body.skip_countdown === true;
    targetData.validation_version = MINIGAME_VALIDATION_VERSION;

    // A paid crop round is armed only by the protected image renderer, after a
    // real clue is ready and immediately before
    // bytes are sent. This prevents image preparation time from consuming play.
    const initialRoundDeadlineAt = !practiceMode && isRoundGameType(game_type)
      ? game_type === 'crop_detective' ? null : createRoundDeadline(game_type, !targetData.skip_countdown)
      : null;
    if (!practiceMode && isRoundGameType(game_type)) {
      const rounds = Array.isArray(targetData.rounds) ? targetData.rounds : [];
      const firstRound = buildPublicRound(game_type, rounds[0], sessionId, userId);
      if (
        !firstRound ||
        rounds.length !== 5 ||
        (game_type !== 'crop_detective' && !initialRoundDeadlineAt)
      ) {
        return res.status(500).json({
          error: 'InternalServerError',
          message: '서버가 첫 라운드를 안전하게 발급하지 못했습니다.'
        });
      }
      gameData = {
        rounds: [firstRound],
        total_rounds: rounds.length,
        round_deadline_at: initialRoundDeadlineAt
      };
    }

    const sessionStartedAt = formatKstDbTime();
    const newSession: MinigameSession = {
      id: sessionId,
      user_id: userId,
      game_type: game_type as any,
      status: 'STARTED',
      target_data: JSON.stringify(targetData),
      validation_version: MINIGAME_VALIDATION_VERSION,
      progress_data: JSON.stringify({
        ...(isActionGame(game_type) ? { action: initialActionState() } : {}),
        round_outcomes: [],
        ...(!practiceMode && isRoundGameType(game_type)
          ? {
              round_deadline_at: initialRoundDeadlineAt,
              ...(game_type === 'crop_detective' ? { round_image_armed_round: null } : {}),
              ...(game_type === 'value_duel' ? { round_started_round: 0 } : {})
            }
          : {})
      }),
      progress_revision: 0,
      // Allow reading the rules and retrying images before ready; the ready
      // action replaces this preparation lease with the actual play deadline.
      expires_at: new Date(Date.now() + (isActionGame(game_type) ? 600_000 : getGameSubmitAllowanceMs(game_type as DailyMinigameType))).toISOString(),
      created_at: sessionStartedAt
    };

    const startResult = await minigameRepository.startSession(newSession, chargeIntervalMinutes);
    if (!startResult.ok) {
      const conflict = /진행 중|활성|started/i.test(String(startResult.reason || ''));
      return res.status(conflict ? 409 : 500).json({
        error: conflict ? 'ActiveMinigameExists' : 'InternalServerError',
        message: startResult.reason || '게임 세션 시작에 실패했습니다.'
      });
    }

    scheduleMinigameSessionExpiry();

    if (isActionGame(game_type)) {
      gameData = publicActionGame(game_type, targetData as ActionTarget, initialActionState(), 0, Date.now(), receivedAt);
    }
    return res.status(200).json({
      session_id: sessionId,
      game_type,
      practice_mode: practiceMode,
      game_data: gameData,
      interrupted_session_closed: interruptedSessionClosed,
      message: interruptedSessionClosed
        ? '이전에 진행 중이던 미니게임은 실패 처리되었고 새 게임을 시작했습니다.'
        : undefined,
      timing: isActionGame(game_type) ? undefined : getSessionTiming({
        ...newSession,
        created_at: sessionStartedAt
      })
    });

  } catch (err: any) {
    if (err instanceof ActionGameError) return res.status(400).json({ message: err.message });
    console.error('[MinigameController] start error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '미니게임을 시작하지 못했습니다.' });
  }
};

// Ordered games require the exact revision. Independent catch cells merge through
// compare-and-swap so one slow response does not block the next visible target.
export const playMinigameAction = async (req: AuthenticatedRequest, res: Response) => {
  const receivedAt = minigameReceivedAt(res);
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: '로그인이 필요합니다.' });
  const { session_id, revision, request_id, action } = req.body || {};
  if (typeof session_id !== 'string' || !Number.isInteger(revision) || revision < 0 ||
    typeof request_id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(request_id) ||
    !action || !['ready', 'sort', 'catch', 'sequence', 'finish'].includes(action.kind)) {
    return res.status(400).json({ message: '게임 입력 정보가 올바르지 않습니다.' });
  }
  const input: ActionInput = { kind: action.kind, value: action.value, frame: action.frame,
    ...(action.values !== undefined ? { values: action.values, offset: action.offset } : {}),
    ...(action.quick_start !== undefined ? { quick_start: action.quick_start } : {}) };
  const fingerprint = JSON.stringify(input);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = await minigameRepository.findSessionById(session_id);
      if (!session) return res.status(404).json({ message: '게임 세션을 찾을 수 없습니다.' });
      if (session.user_id !== userId) return res.status(403).json({ message: '잘못된 세션 소유권입니다.' });
      if (!isActionGame(session.game_type)) return res.status(400).json({ message: '입력을 지원하지 않는 게임입니다.' });
      const target = parseDbJson<ActionTarget>(session.target_data, {} as ActionTarget);
      if (getSessionValidationVersion(session, target) !== MINIGAME_VALIDATION_VERSION) {
        return res.status(400).json({ message: '게임 검증 정보를 확인할 수 없습니다.' });
      }
      const state = readActionState(session.progress_data);
      const currentRevision = session.progress_revision ?? 0;
      const view = () => publicActionGame(session.game_type as typeof ACTION_GAMES[number], target, state, currentRevision, Date.now(), receivedAt);
      const catchInput = session.game_type === 'streamer_catch' && input.kind === 'catch';
      const batchInput = (session.game_type === 'fan_meeting' && input.kind === 'sort' || session.game_type === 'sequence_relay' && input.kind === 'sequence') &&
        Array.isArray(input.values) && input.values.length > 0 && input.values.length <= 64 &&
        Number.isInteger(input.offset) && input.offset! >= 0;
      if (state.last_request === request_id) {
        if (state.last_action !== fingerprint) return res.status(409).json({ message: '이미 다른 입력으로 사용된 요청입니다.' });
        return res.status(200).json({ game_data: view() });
      }
      // A response can be lost while later cells are already saved. The persisted
      // frame/cell key is the idempotency key for a catch throughout the session.
      if (catchInput && Number.isInteger(input.frame) && Number.isInteger(input.value) &&
        revision <= currentRevision && state.clicked.includes(`${input.frame}:${input.value}`)) {
        return res.status(200).json({ game_data: view() });
      }
      // A final flush can overtake an earlier batch. Matching saved prefixes are
      // idempotent even when that earlier response arrives after settlement.
      if (batchInput && revision <= currentRevision && input.offset! + input.values!.length <= (state.inputs?.length || 0) &&
        input.values!.every((value, i) => state.inputs![input.offset! + i] === value)) {
        return res.status(200).json({ game_data: view() });
      }
      if (session.status !== 'STARTED' || !session.expires_at || Date.now() >= new Date(session.expires_at).getTime()) {
        return res.status(409).json({ message: '이미 종료되었거나 만료된 게임입니다.' });
      }
      if (revision > currentRevision || (!catchInput && !batchInput && revision !== currentRevision)) {
        return res.status(409).json({ game_data: view(), message: '게임 진행 상태를 동기화했습니다.' });
      }
      let next;
      try {
        next = advanceActionGame(session.game_type, target, state, input, input.kind === 'ready' ? Date.now() : receivedAt);
      } catch (err) {
        if (err instanceof ActionGameError) return res.status(400).json({ message: err.message, game_data: view() });
        throw err;
      }
      next.last_request = request_id;
      next.last_action = fingerprint;
      // Image loading never consumes play time; arm the full play and settlement
      // windows once, in the same compare-and-swap as the first ready action.
      const expiresAt = state.starts_at === null && next.ends_at !== null
        ? new Date(next.ends_at + 60_000).toISOString() : undefined;
      const saved = await minigameRepository.saveActionProgress(session_id, userId, currentRevision, JSON.stringify({ action: next }), expiresAt);
      if (!saved) {
        if (catchInput || batchInput) continue;
        return res.status(409).json({ message: '입력을 저장 중입니다. 같은 요청을 다시 시도해 주세요.' });
      }
      return res.status(200).json({ game_data: publicActionGame(session.game_type, target, next, currentRevision + 1, Date.now(), receivedAt) });
    }
    return res.status(409).json({ message: '입력을 저장 중입니다. 같은 요청을 다시 시도해 주세요.' });
  } catch (err) {
    if (err instanceof ActionGameError) return res.status(400).json({ message: err.message });
    console.error('[MinigameController] action error:', err);
    return res.status(500).json({ message: '게임 입력을 저장하지 못했습니다. 다시 시도해 주세요.' });
  }
};

// 3. POST /api/minigames/submit
export const submitMinigameResult = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { session_id, payload } = req.body;
  if (!session_id) {
    return res.status(400).json({ error: 'BadRequest', message: '세션 ID가 누락되었습니다.' });
  }

  try {
    // 1. 세션 조회
    const session = await minigameRepository.findSessionById(session_id);
    if (!session) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않은 미니게임 세션입니다.' });
    }
    if (session.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden', message: '잘못된 세션 소유권입니다.' });
    }
    const target = parseDbJson<any>(session.target_data, {});
    const practiceMode = target.practice_mode === true;

    // 배포 전에 발급된 보상 세션도 서버 권위 검증을 우회해 정산되지 않도록 0점으로 원자 종료합니다.
    if (session.status === 'STARTED' && isLegacyUnverifiablePaidSession(session, target)) {
      const closeResult = await minigameRepository.completeSession(session_id, 0);
      if (!closeResult.ok) {
        return res.status(409).json({
          error: 'MinigameSessionCloseFailed',
          message: '기존 보상형 미니게임 세션을 안전하게 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        });
      }
      return res.status(409).json({
        error: 'LegacyMinigameSession',
        message: '이전 검증 방식으로 발급된 미니게임은 보상을 지급할 수 없어 안전하게 종료했습니다. 새 게임을 시작해 주세요.',
        session_closed: true,
        earned_points: 0
      });
    }

    const answer = await getAnswerReveal(session.game_type, target);

    if (session.status === 'COMPLETED') {
      const user = await userRepository.findById(userId);
      const storedResult = getStoredResult(session);

      return res.status(200).json({
        success: true,
        correct: Boolean(storedResult?.correct ?? ((session.earned_points ?? 0) > 0)),
        earned_points: session.earned_points ?? 0,
        new_balance: user?.point ?? 0,
        message: String(storedResult?.message || '이미 처리된 미니게임 결과를 다시 불러왔습니다.'),
        practice_mode: Boolean(storedResult?.practice_mode ?? practiceMode),
        answer: storedResult?.answer || answer
      });
    }
    if (session.status !== 'STARTED') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리되었거나 만료된 세션입니다.' });
    }

    // 서버 사이드 시간 경과 체크 (치팅 패킷 변조 차단)
    const sessionCreatedMs = parseDbKstTimeMs(session.created_at);
    const serverElapsedMs = (Number.isFinite(sessionCreatedMs) ? Math.max(0, Date.now() - sessionCreatedMs) : 0) + (target.skip_countdown === true ? COUNTDOWN_MS : 0);
    const clientRemainingMs = Math.max(0, Math.floor(Number(payload?.client_remaining_ms || 0)));
    const exceededTimeLimit = (allowedMs: number, clientReportedGraceMs = CLIENT_REPORTED_GRACE_MS) => {
      if (serverElapsedMs <= allowedMs + SUBMISSION_GRACE_MS) return false;
      // Reward-bearing play never trusts a client clock. The extended retry
      // window only preserves zero-reward practice sessions across disconnects.
      if (!practiceMode) return true;
      return !(clientRemainingMs > 0 && serverElapsedMs <= allowedMs + clientReportedGraceMs);
    };

    let isCorrect = false;
    let earnedPoints = 0;
    let message = '아쉽게도 정답이 아닙니다!';

    const BASE_REWARD = 1000;
    const BONUS_REWARD = 200;

    // 게임 타입별 채점 및 치팅 검증
    if (isActionGame(session.game_type)) {
      let state = readActionState(session.progress_data);
      if (!state.done) {
        state = advanceActionGame(session.game_type, target as ActionTarget, state, { kind: 'finish' }, Date.now());
        const saved = await minigameRepository.saveActionProgress(session.id, userId, session.progress_revision ?? 0,
          JSON.stringify({ action: state }));
        if (!saved) return res.status(409).json({ message: '진행 기록을 동기화하고 있습니다. 결과 확인을 다시 시도해 주세요.' });
      }
      earnedPoints = actionReward(session.game_type, state);
      isCorrect = earnedPoints > 0;
      const detail = session.game_type === 'sequence_relay' ? `${state.cleared}/5단계 완료`
        : `${state.correct}${session.game_type === 'fan_meeting' ? '장 분류' : '/10회 캐치'} · 실수 ${state.mistakes}회`;
      message = `${ACTION_GAME_NAMES[session.game_type]} ${detail}. ${earnedPoints === 1200
        ? '보너스 200 P를 포함해 1,200 P를 획득했습니다!'
        : earnedPoints === 1000 ? '성공 보상 1,000 P를 획득했습니다!' : '이번에는 성공 조건에 도달하지 못했습니다.'}`;
    } else if (session.game_type === 'puzzle') {
      const { success } = payload || {};
      const hasIssuedPuzzle = Array.isArray(target?.initial_puzzle_pieces);
      const puzzleProof = hasIssuedPuzzle
        ? replayPuzzleMoves(target.initial_puzzle_pieces, payload?.puzzle_moves, payload?.puzzle_pieces)
        : practiceMode && isSolvedLegacyPuzzlePayload(payload?.puzzle_pieces)
          ? { ok: true as const }
          : { ok: false as const, reason: '서버가 발급한 퍼즐 조작 증명이 없습니다.' };
      const solvedPuzzle = puzzleProof.ok;

      // 120초 시간 제한 초과 검증 (카운트다운 3초 + 120초 플레이 + RTT 2초 = 125000ms 초과 시 실패)
      if (exceededTimeLimit(
        COUNTDOWN_MS + PUZZLE_TIME_LIMIT_MS,
        success === true && solvedPuzzle ? TERMINAL_SUCCESS_RETRY_GRACE_MS : CLIENT_REPORTED_GRACE_MS
      )) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임의 120초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : '120초 시간 제한이 초과되어 실패 처리되었습니다.',
          practice_mode: practiceMode,
          answer
        });
      }

      // 퍼즐 4.5초 컷은 패킷 치팅 의심 (카운트다운 3초 + 1.5초 조작)
      if (serverElapsedMs < 4500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true && !solvedPuzzle) {
        return res.status(400).json({
          error: 'BadRequest',
          message: ('reason' in puzzleProof && puzzleProof.reason) || '퍼즐 완료 상태를 서버에서 검증할 수 없습니다.'
        });
      }

      if (solvedPuzzle) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 30초 내 퍼즐 완성 시 보너스 200 P.
        if (completedWithinBonusTime(serverElapsedMs, 'puzzle', 30_000)) {
          earnedPoints += BONUS_REWARD;
          message = `30초 내로 퍼즐을 완성하셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `퍼즐을 무사히 완성하셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      } else {
        message = '120초 시간 제한이 초과되어 실패 처리되었습니다.';
      }

    } else if (session.game_type === 'match') {
      const { success } = payload || {};
      const hasIssuedDeck = Array.isArray(target?.cards) && target.cards.every((card: any) => String(card?.card_id || '').trim());
      const matchProof = hasIssuedDeck
        ? validateMatchPairProof(payload?.matched_pairs, target.cards)
        : practiceMode && isSolvedLegacyMatchPayload(payload?.matched_channel_ids, getMatchTargetChannelIds(target))
          ? { ok: true as const }
          : { ok: false as const, reason: '서버가 발급한 짝맞추기 증명이 없습니다.' };
      const solvedMatch = matchProof.ok;

      // 30초 시간 제한 초과 검증 (카운트다운 3초 + 2초 선공개 + 30초 플레이 + RTT 2초 = 37000ms 초과 시 실패)
      if (exceededTimeLimit(
        COUNTDOWN_MS + MATCH_REVEAL_MS + MATCH_TIME_LIMIT_MS,
        success === true && solvedMatch ? TERMINAL_SUCCESS_RETRY_GRACE_MS : CLIENT_REPORTED_GRACE_MS
      )) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임의 30초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : '30초 시간 제한이 초과되어 실패 처리되었습니다.',
          practice_mode: practiceMode
        });
      }

      // Valid pairs may be entered rapidly; only the mandatory reveal must finish.
      if (serverElapsedMs < COUNTDOWN_MS + MATCH_REVEAL_MS) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true && !solvedMatch) {
        return res.status(400).json({
          error: 'BadRequest',
          message: ('reason' in matchProof && matchProof.reason) || '짝맞추기 완료 상태를 서버에서 검증할 수 없습니다.'
        });
      }

      if (solvedMatch) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 10초 내 완료 시 보너스 200 P.
        if (completedWithinBonusTime(serverElapsedMs, 'match', 10_000)) {
          earnedPoints += BONUS_REWARD;
          message = `10초 내에 짝을 맞추셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `모든 카드의 짝을 찾으셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      }
    } else if (isRoundGameType(session.game_type)) {
      const limitMs = ROUND_GAME_SESSION_LIMIT_MS;
      const minCorrect = session.game_type === 'quiz'
        ? QUIZ_MIN_CORRECT
        : session.game_type === 'value_duel'
          ? VALUE_DUEL_MIN_CORRECT
          : CROP_DETECTIVE_MIN_CORRECT;
      const gameLabel = session.game_type === 'quiz'
        ? '인물 퀴즈'
        : session.game_type === 'value_duel'
          ? '시세 듀얼'
          : '카드 확대 탐정';

      if (exceededTimeLimit(COUNTDOWN_MS + limitMs)) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임 세션 시간이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : `${gameLabel} 세션 시간이 초과되어 실패 처리되었습니다.`,
          practice_mode: practiceMode
        });
      }

      if (serverElapsedMs < 4500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      const parsedAnswers = practiceMode
        ? toRoundAnswers(payload?.answers)
        : (() => {
          const outcomes = getStoredRoundOutcomes(session);
          const expectedRounds = Array.isArray(target?.rounds) ? target.rounds.length : 0;
          if (expectedRounds <= 0 || outcomes.length !== expectedRounds) {
            return { ok: false as const, reason: '모든 라운드의 서버 판정이 끝난 뒤 결과를 확인할 수 있습니다.' };
          }
          return { ok: true as const, answers: getRoundAnswersFromOutcomes(outcomes) };
        })();
      if (!parsedAnswers.ok) {
        return res.status(practiceMode ? 400 : 409).json({ error: practiceMode ? 'BadRequest' : 'RoundProgressIncomplete', message: parsedAnswers.reason });
      }

      const score = scoreRoundGameAnswers(session.game_type, parsedAnswers.answers, target);
      if (!score.valid) {
        return res.status(400).json({ error: 'BadRequest', message: score.reason || '라운드 답안을 서버에서 검증할 수 없습니다.' });
      }

      if (score.correctCount >= minCorrect) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        if (score.perfect) {
          earnedPoints += BONUS_REWARD;
          message = `${gameLabel} 5문제를 모두 맞추셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `${gameLabel} ${score.correctCount}/${score.totalRounds}문제 성공! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      } else {
        message = `${gameLabel} ${score.correctCount}/${score.totalRounds}문제 정답입니다. 3문제 이상 맞혀야 성공입니다.`;
      }
    }

    if (practiceMode) {
      earnedPoints = 0;
      message = isCorrect
        ? '연습 게임을 성공했습니다! 연습 모드에서는 동전을 소모하지 않으며 포인트도 지급되지 않습니다.'
        : '연습 게임을 완료했습니다. 연습 모드에서는 동전을 소모하지 않으며 포인트도 지급되지 않습니다.';
    }

    // 2. 세션 완료 및 포인트 적립
    const resultSnapshot = {
      correct: isCorrect,
      earned_points: earnedPoints,
      message,
      practice_mode: practiceMode,
      answer
    };
    const completeResult = await minigameRepository.completeSession(
      session_id,
      earnedPoints,
      JSON.stringify(resultSnapshot)
    );
    if (!completeResult.ok) {
      return res.status(500).json({ error: 'InternalServerError', message: completeResult.reason || '포인트 지급에 실패했습니다.' });
    }
    const storedSettlement = parseStoredResultData(completeResult.resultData);
    if (completeResult.settledNow === false && !storedSettlement) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: '이미 완료된 미니게임의 확정 결과를 불러오지 못했습니다.'
      });
    }
    const settledNow = completeResult.settledNow !== false;
    const authoritativeResult = storedSettlement || resultSnapshot;
    const authoritativeEarnedPoints = Number(
      authoritativeResult.earned_points ?? completeResult.earnedPoints ?? earnedPoints
    );
    if (![0, BASE_REWARD, BASE_REWARD + BONUS_REWARD].includes(authoritativeEarnedPoints)) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: '저장된 미니게임 보상 결과가 올바르지 않습니다.'
      });
    }
    const authoritativeCorrect = authoritativeResult.correct === true;
    const authoritativePracticeMode = authoritativeResult.practice_mode === true;
    const authoritativeMessage = String(
      authoritativeResult.message || (settledNow ? message : '이미 처리된 미니게임 결과를 다시 불러왔습니다.')
    );
    const authoritativeAnswer = Object.prototype.hasOwnProperty.call(authoritativeResult, 'answer')
      ? authoritativeResult.answer
      : settledNow
        ? answer
        : undefined;

    if (settledNow && authoritativeCorrect && !authoritativePracticeMode) {
      recordAchievementEvent({
        userId,
        eventType: 'minigame.success',
        eventKey: `minigame:success:${userId}:${session_id}`,
        metadata: { session_id, game_type: session.game_type, earned_points: authoritativeEarnedPoints },
        stats: {
          'minigame.success.count': 1,
          [`minigame.success.${session.game_type}.count`]: 1
        },
        refreshSnapshots: true
      }).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      correct: authoritativeCorrect,
      earned_points: authoritativeEarnedPoints,
      new_balance: completeResult.newPoints ?? 0,
      message: authoritativeMessage,
      practice_mode: authoritativePracticeMode,
      answer: authoritativeAnswer
    });

  } catch (err: any) {
    if (err instanceof ActionGameError) return res.status(409).json({ message: err.message });
    console.error('[MinigameController] submit error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '게임 결과 제출 중 오류가 발생했습니다.' });
  }
};

export const checkMinigameRoundAnswer = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { session_id, payload } = req.body;
  if (!session_id) {
    return res.status(400).json({ error: 'BadRequest', message: '세션 ID가 누락되었습니다.' });
  }

  try {
    const session = await minigameRepository.findSessionById(session_id);
    if (!session) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않은 미니게임 세션입니다.' });
    }
    if (session.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden', message: '잘못된 세션 소유권입니다.' });
    }
    if (session.status !== 'STARTED') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리되었거나 만료된 세션입니다.' });
    }
    if (!isRoundGameType(session.game_type)) {
      return res.status(400).json({ error: 'BadRequest', message: '라운드 판정을 지원하지 않는 미니게임입니다.' });
    }

    const target = parseDbJson<any>(session.target_data, {});
    const practiceMode = target.practice_mode === true;
    if (isLegacyUnverifiablePaidSession(session, target)) {
      const closeResult = await minigameRepository.completeSession(session_id, 0);
      if (!closeResult.ok) {
        return res.status(409).json({
          error: 'MinigameSessionCloseFailed',
          message: '기존 보상형 미니게임 세션을 안전하게 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        });
      }
      return res.status(409).json({
        error: 'LegacyMinigameSession',
        message: '이전 검증 방식으로 발급된 미니게임은 안전하게 종료했습니다. 새 게임을 시작해 주세요.',
        session_closed: true,
        earned_points: 0
      });
    }
    const round = Number(payload?.round);
    const selectedChannelId = String(payload?.selected_channel_id || '').trim();
    const timedOut = payload?.timed_out === true;
    if (!Number.isInteger(round) || round < 0 || (!timedOut && !selectedChannelId)) {
      return res.status(400).json({ error: 'BadRequest', message: '라운드 답안이 올바르지 않습니다.' });
    }

    const sessionCreatedMs = parseDbKstTimeMs(session.created_at);
    const serverElapsedMs = (Number.isFinite(sessionCreatedMs) ? Math.max(0, Date.now() - sessionCreatedMs) : 0) + (target.skip_countdown === true ? COUNTDOWN_MS : 0);
    const roundAnswerAllowanceMs = getGameSubmitAllowanceMs(session.game_type) + (practiceMode ? CLIENT_REPORTED_GRACE_MS : 0);
    if (serverElapsedMs > roundAnswerAllowanceMs) {
      return res.status(400).json({ error: 'BadRequest', message: '미니게임 시간 제한이 초과되었습니다.' });
    }

    const rounds = Array.isArray(target?.rounds) ? target.rounds : [];
    const roundData = rounds[round];
    if (!roundData || Number(roundData?.round) !== round) {
      return res.status(400).json({ error: 'BadRequest', message: '존재하지 않는 라운드입니다.' });
    }

    let correctChannelIds: string[] = [];
    let choiceIds: string[] = [];
    if (session.game_type === 'value_duel') {
      choiceIds = [roundData.left?.channel_id, roundData.right?.channel_id]
        .map((id) => String(id || '').trim())
        .filter(Boolean);
      correctChannelIds = getValueDuelCorrectIds(roundData);
    } else {
      const choices = Array.isArray(roundData?.choices) ? roundData.choices : [];
      choiceIds = choices.map((choice: any) => String(choice?.channel_id || '').trim()).filter(Boolean);
      correctChannelIds = [String(roundData.answer_channel_id || '').trim()].filter(Boolean);
    }
    if (!timedOut && !choiceIds.includes(selectedChannelId)) {
      return res.status(400).json({ error: 'BadRequest', message: '보기 외 선택값입니다.' });
    }

    const hasNextRound = round + 1 < rounds.length;
    const deferValueDuelNextRound = !practiceMode && session.game_type === 'value_duel';
    const nextPublicRound = hasNextRound && !deferValueDuelNextRound
      ? buildPublicRound(session.game_type, rounds[round + 1], session.id, userId)
      : null;
    const nextRoundDeadlineAt = !practiceMode && hasNextRound && !deferValueDuelNextRound
      ? session.game_type === 'crop_detective' ? null : createRoundDeadline(session.game_type)
      : null;
    if (hasNextRound && !deferValueDuelNextRound && !nextPublicRound) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: '서버가 다음 라운드를 안전하게 발급하지 못했습니다.'
      });
    }

    let authoritativeNextRoundDeadlineAt = nextRoundDeadlineAt;
    let issuedNextRound = nextPublicRound;
    let authoritativeHasNextRound = hasNextRound;
    if (!practiceMode) {
      const recordResult = await minigameRepository.recordRoundOutcome(
        session_id,
        userId,
        round,
        timedOut ? null : selectedChannelId,
        nextRoundDeadlineAt
      );
      if (!recordResult.ok) {
        const deadlineExpired = /시간|마감|deadline|expired/i.test(String(recordResult.reason || ''));
        return res.status(409).json({
          error: deadlineExpired ? 'RoundTimeExpired' : 'RoundAlreadyResolved',
          message: recordResult.reason || '이미 확정된 라운드이거나 순서가 올바르지 않습니다.'
        });
      }
      authoritativeNextRoundDeadlineAt = recordResult.session
        ? getStoredRoundDeadline(recordResult.session)
        : nextRoundDeadlineAt;
      if (recordResult.session) {
        const storedOutcomes = getStoredRoundOutcomes(recordResult.session);
        const authoritativeNextRoundIndex = storedOutcomes.length;
        authoritativeHasNextRound = authoritativeNextRoundIndex < rounds.length;
        issuedNextRound = authoritativeHasNextRound && !deferValueDuelNextRound
          ? buildPublicRound(session.game_type, rounds[authoritativeNextRoundIndex], session.id, userId)
          : null;
      }
    }

    return res.status(200).json({
      success: true,
      correct: !timedOut && correctChannelIds.includes(selectedChannelId),
      round,
      correct_channel_ids: timedOut ? [] : correctChannelIds,
      timed_out: timedOut,
      total_rounds: rounds.length,
      ...(!practiceMode ? {
        server_now: new Date().toISOString(),
        next_round: issuedNextRound,
        next_round_deadline_at: authoritativeNextRoundDeadlineAt,
        ...(session.game_type === 'value_duel'
          ? { has_next_round: authoritativeHasNextRound }
          : {})
      } : {})
    });
  } catch (err: any) {
    console.error('[MinigameController] round check error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '라운드 결과 확인 중 오류가 발생했습니다.' });
  }
};

export const startMinigameRound = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const sessionId = String(req.body?.session_id || '').trim();
  const round = Number(req.body?.round);
  if (!sessionId || !Number.isInteger(round) || round < 0) {
    return res.status(400).json({ error: 'BadRequest', message: '시작할 라운드 정보가 올바르지 않습니다.' });
  }

  try {
    const session = await minigameRepository.findSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않은 미니게임 세션입니다.' });
    }
    if (session.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden', message: '잘못된 세션 소유권입니다.' });
    }
    if (session.status !== 'STARTED') {
      return res.status(409).json({ error: 'MinigameSessionClosed', message: '이미 처리되었거나 만료된 세션입니다.' });
    }
    if (session.game_type !== 'value_duel') {
      return res.status(400).json({ error: 'BadRequest', message: '시세 듀얼 라운드만 직접 시작할 수 있습니다.' });
    }

    const target = parseDbJson<any>(session.target_data, {});
    if (target.practice_mode === true) {
      return res.status(400).json({ error: 'BadRequest', message: '보상형 시세 듀얼 세션이 아닙니다.' });
    }
    if (isLegacyUnverifiablePaidSession(session, target)) {
      return res.status(409).json({
        error: 'LegacyMinigameSession',
        message: '이전 검증 방식으로 발급된 미니게임은 새 라운드를 시작할 수 없습니다.'
      });
    }
    const targetValidation = scoreValueDuelAnswers([], target);
    if (!targetValidation.valid) {
      return res.status(409).json({
        error: 'InvalidMinigameSession',
        message: targetValidation.reason || '시세 듀얼 문제 데이터가 올바르지 않습니다.'
      });
    }

    const proposedDeadline = createRoundDeadline('value_duel');
    if (!proposedDeadline) {
      return res.status(500).json({ error: 'InternalServerError', message: '라운드 마감 시간을 생성하지 못했습니다.' });
    }
    const armResult = await minigameRepository.armRoundDeadline(
      sessionId,
      userId,
      round,
      proposedDeadline
    );
    if (!armResult.ok || !armResult.session) {
      const deadlineExpired = /시간|마감|만료|deadline|expired/i.test(String(armResult.reason || ''));
      return res.status(409).json({
        error: deadlineExpired ? 'RoundTimeExpired' : 'RoundStartConflict',
        message: armResult.reason || '현재 라운드를 시작할 수 없습니다.'
      });
    }

    const authoritativeSession = armResult.session;
    const authoritativeTarget = parseDbJson<any>(authoritativeSession.target_data, {});
    const authoritativeRounds = Array.isArray(authoritativeTarget?.rounds)
      ? authoritativeTarget.rounds
      : [];
    const authoritativeOutcomes = getStoredRoundOutcomes(authoritativeSession);
    const deadline = getStoredRoundDeadline(authoritativeSession);
    const roundData = authoritativeOutcomes.length === round
      ? buildPublicRound('value_duel', authoritativeRounds[round], sessionId, userId)
      : null;
    if (
      authoritativeRounds.length !== VALUE_DUEL_ROUND_COUNT ||
      !deadline ||
      !roundData
    ) {
      return res.status(409).json({
        error: 'InvalidMinigameRoundState',
        message: '서버에 저장된 시세 듀얼 라운드 상태가 올바르지 않습니다.'
      });
    }

    return res.status(200).json({
      success: true,
      round,
      round_data: roundData,
      round_deadline_at: deadline,
      server_now: new Date().toISOString(),
      total_rounds: authoritativeRounds.length
    });
  } catch (err: any) {
    console.error('[MinigameController] round start error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '라운드 시작 중 오류가 발생했습니다.' });
  }
};
