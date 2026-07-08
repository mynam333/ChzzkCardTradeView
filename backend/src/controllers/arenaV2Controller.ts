import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { streamerRepository } from '../repositories';
import {
  arenaV2TargetExists,
  cancelArenaV2BattleRoyaleQueue,
  cancelArenaV2QuickQueue,
  createArenaV2ReplayHoldAdmin,
  createArenaV2Match,
  createArenaV2Report,
  createArenaV2SeasonAdmin,
  createArenaV2StreamerRightRequest,
  grantArenaV2SeasonRewardsAdmin,
  getArenaV2CurrentSeason,
  getArenaV2BattleRoyaleQueueStatus,
  getArenaV2CardVersion,
  getArenaV2BattleRoyale,
  getArenaV2CurrentRewardsForUser,
  getArenaV2MatchForUser,
  getArenaV2QuickQueueStatus,
  getArenaV2Replay,
  getMyArenaV2StreamerCard,
  getArenaV2WikiEntry,
  joinArenaV2BattleRoyaleQueue,
  joinArenaV2QuickQueue,
  listArenaV2Rankings,
  listArenaV2WikiEntries,
  listArenaV2Cards,
  listArenaV2OwnedCardsForUser,
  listArenaV2DecksForUser,
  listArenaV2ReportsAdmin,
  listArenaV2ReportsForUser,
  listArenaV2StreamerRightRequestsAdmin,
  listArenaV2StreamerRightRequestsForUser,
  deleteArenaV2DeckForUser,
  disableMyArenaV2StreamerCard,
  enableMyArenaV2StreamerCard,
  holdArenaV2RewardGrantAdmin,
  previewArenaV2SeasonRewardsAdmin,
  recordArenaV2OpsFlagAdmin,
  releaseArenaV2RewardGrantAdmin,
  reviewArenaV2ReportAdmin,
  reviewArenaV2StreamerRightRequestAdmin,
  revalidateArenaV2DeckForUser,
  saveArenaV2Deck,
  submitArenaV2Mulligan,
  submitArenaV2TurnActions,
  transitionArenaV2SeasonAdmin,
  updateMyArenaV2StreamerCard,
  updateArenaV2SeasonAdmin,
  validateArenaV2DeckForSeason
} from '../services/arenaV2Service';

const requireUser = (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    return null;
  }
  return req.user;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

const assertBodyString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const handleArenaV2DeckUseError = (res: Response, message: string) => {
  if (message === 'ArenaV2DeckNotFound') return res.status(404).json({ error: message, message: '덱을 찾을 수 없습니다.' });
  if (message === 'ArenaV2DeckForbidden') return res.status(403).json({ error: message, message: '다른 유저의 덱은 사용할 수 없습니다.' });
  if (message === 'ArenaV2DeckInvalid') return res.status(400).json({ error: message, message: '덱이 공식 규칙을 통과하지 못했습니다.' });
  if (message === 'ArenaV2DeckSeasonMismatch') return res.status(409).json({ error: message, message: '덱과 시즌이 일치하지 않습니다.' });
  if (message === 'ArenaV2SeasonClosed') return res.status(409).json({ error: message, message: '대전 가능한 시즌이 아닙니다.' });
  return null;
};

export const getArenaV2CurrentSeasonController = async (_req: Request, res: Response) => {
  const season = await getArenaV2CurrentSeason();
  return res.status(200).json({ season });
};

export const validateArenaV2DeckController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const seasonId = assertBodyString(req.body?.seasonId);
  const cardVersionIds = stringArray(req.body?.cardVersionIds);

  if (!seasonId) {
    return res.status(400).json({ error: 'ArenaSeasonRequired', message: 'seasonId가 필요합니다.' });
  }

  const validation = await validateArenaV2DeckForSeason(seasonId, cardVersionIds);
  return res.status(200).json(validation);
};

export const listArenaV2CardsController = async (req: Request, res: Response) => {
  const costMin = typeof req.query.costMin === 'string' ? Number(req.query.costMin) : undefined;
  const costMax = typeof req.query.costMax === 'string' ? Number(req.query.costMax) : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const cards = await listArenaV2Cards({
    seasonId: typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined,
    class: typeof req.query.class === 'string' ? req.query.class : undefined,
    costMin,
    costMax,
    keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
    streamerName: typeof req.query.streamerName === 'string' ? req.query.streamerName : undefined,
    limit
  });
  return res.status(200).json({ cards });
};

export const listMyArenaV2OwnedCardsController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const costMin = typeof req.query.costMin === 'string' ? Number(req.query.costMin) : undefined;
  const costMax = typeof req.query.costMax === 'string' ? Number(req.query.costMax) : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const cards = await listArenaV2OwnedCardsForUser(user.id, {
    seasonId: typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined,
    class: typeof req.query.class === 'string' ? req.query.class : undefined,
    costMin,
    costMax,
    keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
    streamerName: typeof req.query.streamerName === 'string' ? req.query.streamerName : undefined,
    limit
  });
  return res.status(200).json({ cards });
};

export const getArenaV2CardDetailController = async (req: Request, res: Response) => {
  const cardId = assertBodyString(req.params?.card_id);
  const card = await getArenaV2CardVersion(cardId);
  if (!card) {
    return res.status(404).json({ error: 'ArenaV2CardNotFound', message: '아레나 v2 카드를 찾을 수 없습니다.' });
  }
  return res.status(200).json({ card });
};

export const listArenaV2DecksController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const decks = await listArenaV2DecksForUser(user.id, seasonId);
  return res.status(200).json({ decks });
};

export const saveArenaV2DeckController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = assertBodyString(req.body?.seasonId);
  const name = assertBodyString(req.body?.name);
  const modeScope = assertBodyString(req.body?.modeScope) as any;
  const deckId = assertBodyString(req.body?.deckId) || undefined;
  const cardVersionIds = stringArray(req.body?.cardVersionIds);
  const allowedModeScopes = new Set(['all', 'quick', 'battle_royale_8', 'bot']);

  if (!seasonId || !name || !allowedModeScopes.has(modeScope)) {
    return res.status(400).json({ error: 'ArenaV2DeckRequestInvalid', message: 'seasonId, name, modeScope가 필요합니다.' });
  }

  try {
    const deck = await saveArenaV2Deck({
      userId: user.id,
      deckId,
      seasonId,
      name,
      modeScope,
      cardVersionIds
    });
    return res.status(deckId ? 200 : 201).json({ deck });
  } catch (err: any) {
    if (err?.message === 'ArenaV2DeckNotFound') {
      return res.status(404).json({ error: 'ArenaV2DeckNotFound', message: '덱을 찾을 수 없습니다.' });
    }
    if (err?.message === 'ArenaV2DeckForbidden') {
      return res.status(403).json({ error: 'ArenaV2DeckForbidden', message: '다른 유저의 덱은 수정할 수 없습니다.' });
    }
    throw err;
  }
};

export const updateArenaV2DeckController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deckId = assertBodyString(req.params?.deck_id);
  const seasonId = assertBodyString(req.body?.seasonId);
  const name = assertBodyString(req.body?.name);
  const modeScope = assertBodyString(req.body?.modeScope) as any;
  const cardVersionIds = stringArray(req.body?.cardVersionIds);
  const allowedModeScopes = new Set(['all', 'quick', 'battle_royale_8', 'bot']);

  if (!deckId || !seasonId || !name || !allowedModeScopes.has(modeScope)) {
    return res.status(400).json({ error: 'ArenaV2DeckRequestInvalid', message: 'deckId, seasonId, name, modeScope가 필요합니다.' });
  }

  try {
    const deck = await saveArenaV2Deck({
      userId: user.id,
      deckId,
      seasonId,
      name,
      modeScope,
      cardVersionIds
    });
    return res.status(200).json({ deck });
  } catch (err: any) {
    const handled = handleArenaV2DeckUseError(res, String(err?.message || ''));
    if (handled) return handled;
    throw err;
  }
};

export const deleteArenaV2DeckController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deckId = assertBodyString(req.params?.deck_id);
  if (!deckId) {
    return res.status(400).json({ error: 'ArenaV2DeckRequestInvalid', message: 'deckId가 필요합니다.' });
  }

  try {
    const result = await deleteArenaV2DeckForUser(user.id, deckId);
    return res.status(200).json(result);
  } catch (err: any) {
    const handled = handleArenaV2DeckUseError(res, String(err?.message || ''));
    if (handled) return handled;
    throw err;
  }
};

export const revalidateArenaV2DeckController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deckId = assertBodyString(req.params?.deck_id);
  if (!deckId) {
    return res.status(400).json({ error: 'ArenaV2DeckRequestInvalid', message: 'deckId가 필요합니다.' });
  }

  try {
    const deck = await revalidateArenaV2DeckForUser(user.id, deckId);
    return res.status(200).json({ deck, validation: deck.validationResult });
  } catch (err: any) {
    const handled = handleArenaV2DeckUseError(res, String(err?.message || ''));
    if (handled) return handled;
    throw err;
  }
};

export const createArenaV2MatchController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const mode = assertBodyString(req.body?.mode) as any;
  const seasonId = assertBodyString(req.body?.seasonId) || undefined;
  const deckId = assertBodyString(req.body?.deckId);
  const botDifficulty = assertBodyString(req.body?.botDifficulty) as any || undefined;
  const allowedModes = new Set(['bot', 'quick', 'battle_royale_8']);
  const allowedBotDifficulties = new Set(['beginner', 'easy', 'normal', 'hard', 'expert']);

  if (!allowedModes.has(mode) || !deckId) {
    return res.status(400).json({ error: 'ArenaV2CreateMatchInvalid', message: 'mode와 deckId가 필요합니다.' });
  }
  if (botDifficulty && !allowedBotDifficulties.has(botDifficulty)) {
    return res.status(400).json({ error: 'ArenaV2BotDifficultyInvalid', message: '지원하지 않는 봇 난이도입니다.' });
  }

  try {
    const match = await createArenaV2Match({
      userId: user.id,
      mode,
      seasonId,
      deckId,
      botDifficulty
    });
    return res.status(201).json({ match });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2UseQuickQueue') {
      return res.status(409).json({ error: message, message: '빠른대전은 /api/arena/matchmaking/quick/join을 사용합니다.' });
    }
    if (message === 'ArenaV2UseBattleRoyaleQueue') {
      return res.status(409).json({ error: message, message: '8인전은 /api/arena/battle-royales/join을 사용합니다.' });
    }
    if (message === 'ArenaV2DeckNotFound') return res.status(404).json({ error: message, message: '덱을 찾을 수 없습니다.' });
    if (message === 'ArenaV2DeckForbidden') return res.status(403).json({ error: message, message: '다른 유저의 덱은 사용할 수 없습니다.' });
    if (message === 'ArenaV2DeckInvalid') return res.status(400).json({ error: message, message: '덱이 공식 규칙을 통과하지 못했습니다.' });
    if (message === 'ArenaV2SeasonClosed') return res.status(409).json({ error: message, message: '대전 가능한 시즌이 아닙니다.' });
    if (message === 'ArenaV2BotDeckUnavailable') return res.status(409).json({ error: message, message: '봇전을 만들 카드 풀이 부족합니다.' });
    throw err;
  }
};

export const createArenaV2BotMatchController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const seasonId = assertBodyString(req.body?.seasonId) || undefined;
  const deckId = assertBodyString(req.body?.deckId);
  const botDifficulty = assertBodyString(req.body?.botDifficulty) as any || undefined;
  const allowedBotDifficulties = new Set(['beginner', 'easy', 'normal', 'hard', 'expert']);

  if (!deckId) {
    return res.status(400).json({ error: 'ArenaV2CreateBotMatchInvalid', message: 'deckId가 필요합니다.' });
  }
  if (botDifficulty && !allowedBotDifficulties.has(botDifficulty)) {
    return res.status(400).json({ error: 'ArenaV2BotDifficultyInvalid', message: '지원하지 않는 봇 난이도입니다.' });
  }

  try {
    const match = await createArenaV2Match({
      userId: user.id,
      mode: 'bot',
      seasonId,
      deckId,
      botDifficulty
    });
    return res.status(201).json({ match });
  } catch (err: any) {
    const message = String(err?.message || '');
    const handled = handleArenaV2DeckUseError(res, message);
    if (handled) return handled;
    if (message === 'ArenaV2BotDeckUnavailable') return res.status(409).json({ error: message, message: '봇전을 만들 카드 풀이 부족합니다.' });
    throw err;
  }
};

export const joinArenaV2QuickQueueController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const deckId = assertBodyString(req.body?.deckId);
  const seasonId = assertBodyString(req.body?.seasonId) || undefined;
  if (!deckId) {
    return res.status(400).json({ error: 'ArenaV2QuickQueueInvalid', message: 'deckId가 필요합니다.' });
  }

  try {
    const ticket = await joinArenaV2QuickQueue({ userId: user.id, deckId, seasonId });
    return res.status(200).json({ status: ticket.status, ticket });
  } catch (err: any) {
    const handled = handleArenaV2DeckUseError(res, String(err?.message || ''));
    if (handled) return handled;
    throw err;
  }
};

export const getMyArenaV2QuickQueueStatusController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const status = await getArenaV2QuickQueueStatus(user.id, seasonId);
  return res.status(200).json(status);
};

export const cancelMyArenaV2QuickQueueController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = assertBodyString(req.body?.seasonId) || (typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined);
  const result = await cancelArenaV2QuickQueue(user.id, seasonId);
  return res.status(200).json(result);
};

export const joinArenaV2BattleRoyaleQueueController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const deckId = assertBodyString(req.body?.deckId);
  const seasonId = assertBodyString(req.body?.seasonId) || undefined;
  if (!deckId) {
    return res.status(400).json({ error: 'ArenaV2BattleRoyaleQueueInvalid', message: 'deckId가 필요합니다.' });
  }

  try {
    const ticket = await joinArenaV2BattleRoyaleQueue({ userId: user.id, deckId, seasonId });
    return res.status(200).json({ status: ticket.status, ticket });
  } catch (err: any) {
    const handled = handleArenaV2DeckUseError(res, String(err?.message || ''));
    if (handled) return handled;
    throw err;
  }
};

export const getMyArenaV2BattleRoyaleQueueStatusController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const status = await getArenaV2BattleRoyaleQueueStatus(user.id, seasonId);
  return res.status(200).json(status);
};

export const cancelMyArenaV2BattleRoyaleQueueController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = assertBodyString(req.body?.seasonId) || (typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined);
  const result = await cancelArenaV2BattleRoyaleQueue(user.id, seasonId);
  return res.status(200).json(result);
};

export const getArenaV2MatchController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const matchId = assertBodyString(req.params?.match_id);
  const match = await getArenaV2MatchForUser(matchId, user.id);
  if (!match) {
    return res.status(404).json({ error: 'ArenaV2MatchNotFound', message: '아레나 v2 매치를 찾을 수 없습니다.' });
  }
  return res.status(200).json({ match });
};

export const submitArenaV2TurnActionsController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const matchId = assertBodyString(req.params?.match_id);
  const turnNo = Number(req.body?.turnNo);
  const revision = Number(req.body?.revision);
  const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
  const isFinal = req.body?.isFinal === true;

  if (!matchId || !Number.isInteger(turnNo) || turnNo < 1 || !Number.isInteger(revision) || revision < 0) {
    return res.status(400).json({ error: 'ArenaV2TurnActionInvalid', message: 'turnNo, revision, actions가 필요합니다.' });
  }

  try {
    const result = await submitArenaV2TurnActions({
      userId: user.id,
      matchId,
      turnNo,
      revision,
      isFinal,
      actions
    });
    return res.status(result.accepted ? 200 : 422).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2MatchNotFound') return res.status(404).json({ error: message, message: '아레나 v2 매치를 찾을 수 없습니다.' });
    if (message === 'ArenaV2MatchForbidden') return res.status(403).json({ error: message, message: '이 매치에 접근할 수 없습니다.' });
    if (message === 'ArenaV2MatchNotPlanning') return res.status(409).json({ error: message, message: '현재 턴 행동을 제출할 수 없는 상태입니다.' });
    if (message === 'ArenaV2TurnMismatch') return res.status(409).json({ error: message, message: '현재 턴 번호와 제출 턴이 다릅니다.' });
    if (message === 'ArenaV2RevisionNotIncreasing') return res.status(409).json({ error: message, message: '이전 제출보다 큰 revision이 필요합니다.' });
    throw err;
  }
};

export const submitArenaV2MulliganController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const matchId = assertBodyString(req.params?.match_id);
  const replaceCardInstanceIds = stringArray(req.body?.replaceCardInstanceIds);
  if (!matchId) {
    return res.status(400).json({ error: 'ArenaV2MulliganInvalid', message: 'matchId가 필요합니다.' });
  }

  try {
    const result = await submitArenaV2Mulligan({ userId: user.id, matchId, replaceCardInstanceIds });
    return res.status(200).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2MatchNotFound') return res.status(404).json({ error: message, message: '아레나 v2 매치를 찾을 수 없습니다.' });
    if (message === 'ArenaV2MatchForbidden') return res.status(403).json({ error: message, message: '이 매치에 접근할 수 없습니다.' });
    if (message === 'ArenaV2MatchNotMulligan') return res.status(409).json({ error: message, message: '멀리건을 제출할 수 있는 상태가 아닙니다.' });
    if (message === 'ArenaV2MulliganCardInvalid') return res.status(400).json({ error: message, message: '손패에 없는 카드는 멀리건할 수 없습니다.' });
    if (message === 'ArenaV2MulliganTooManyCards') return res.status(400).json({ error: message, message: '멀리건은 최대 3장까지 가능합니다.' });
    if (message === 'ArenaV2MulliganAlreadyDone') return res.status(409).json({ error: message, message: '이미 멀리건을 제출했습니다.' });
    throw err;
  }
};

export const getArenaV2ReplayController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const matchId = assertBodyString(req.params?.match_id);
  try {
    const replay = await getArenaV2Replay(matchId, user.id);
    if (!replay) {
      return res.status(404).json({ error: 'ArenaV2ReplayNotFound', message: '리플레이를 찾을 수 없습니다.' });
    }
    return res.status(200).json(replay);
  } catch (err: any) {
    if (String(err?.message || '') === 'ArenaReplayExpired') {
      return res.status(410).json({ error: 'ArenaReplayExpired', message: '리플레이 보존 기간이 만료되었습니다.' });
    }
    throw err;
  }
};

export const listArenaV2RankingsController = async (req: Request, res: Response) => {
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const rankings = await listArenaV2Rankings(seasonId, limit);
  return res.status(200).json(rankings);
};

export const getArenaV2CurrentRewardsController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const rewards = await getArenaV2CurrentRewardsForUser(user.id, seasonId);
  if (!rewards) {
    return res.status(404).json({ error: 'ArenaV2SeasonNotFound', message: '보상 조회 가능한 시즌이 없습니다.' });
  }
  return res.status(200).json(rewards);
};

export const getArenaV2BattleRoyaleController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const battleRoyaleId = assertBodyString(req.params?.battle_royale_id || req.params?.battleRoyaleId);
  const battleRoyale = await getArenaV2BattleRoyale(battleRoyaleId, user.id);
  if (!battleRoyale) {
    return res.status(404).json({ error: 'ArenaV2BattleRoyaleNotFound', message: '8인전 상태를 찾을 수 없습니다.' });
  }
  return res.status(200).json({ battleRoyale });
};

export const listArenaV2WikiController = async (_req: Request, res: Response) => {
  return res.status(200).json({ entries: listArenaV2WikiEntries() });
};

export const getArenaV2WikiEntryController = async (req: Request, res: Response) => {
  const slug = assertBodyString(req.params?.slug);
  const entry = getArenaV2WikiEntry(slug);
  if (!entry) {
    return res.status(404).json({ error: 'ArenaV2WikiNotFound', message: '위키 문서를 찾을 수 없습니다.' });
  }
  return res.status(200).json({ entry });
};

export const createArenaV2SeasonAdminController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const seasonKey = assertBodyString(req.body?.seasonKey);
  const name = assertBodyString(req.body?.name);
  const startsAt = assertBodyString(req.body?.startsAt);
  const endsAt = assertBodyString(req.body?.endsAt);
  const cardPoolVersion = assertBodyString(req.body?.cardPoolVersion);
  const balanceVersion = assertBodyString(req.body?.balanceVersion);
  if (!seasonKey || !name || !startsAt || !endsAt || !cardPoolVersion || !balanceVersion) {
    return res.status(400).json({ error: 'ArenaV2SeasonInvalid', message: '시즌 생성 필수 값이 부족합니다.' });
  }
  const season = await createArenaV2SeasonAdmin({
    seasonKey,
    name,
    startsAt,
    endsAt,
    modesEnabled: req.body?.modesEnabled || {},
    cardPoolVersion,
    balanceVersion,
    mmrTierTable: Array.isArray(req.body?.mmrTierTable) ? req.body.mmrTierTable : [],
    rewardTable: Array.isArray(req.body?.rewardTable) ? req.body.rewardTable : [],
    createdBy: user.id
  });
  return res.status(201).json({ season });
};

export const updateArenaV2SeasonAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  try {
    const seasonId = assertBodyString(req.params?.season_id) || assertBodyString(req.body?.seasonId);
    const season = await updateArenaV2SeasonAdmin(seasonId, req.body || {});
    return res.status(200).json({ season });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaV2SeasonLocked') return res.status(409).json({ error: message, message: '잠긴 시즌은 수정할 수 없습니다.' });
    throw err;
  }
};

export const transitionArenaV2SeasonAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const toStatus = assertBodyString(req.body?.toStatus);
  const reason = assertBodyString(req.body?.reason);
  if (!toStatus || !reason) {
    return res.status(400).json({ error: 'ArenaV2SeasonTransitionInvalid', message: 'toStatus와 reason이 필요합니다.' });
  }
  try {
    const result = await transitionArenaV2SeasonAdmin(assertBodyString(req.params?.season_id), toStatus, reason);
    return res.status(200).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaV2SeasonTransitionInvalid') return res.status(409).json({ error: message, message: '허용되지 않는 시즌 전환입니다.' });
    throw err;
  }
};

export const previewArenaV2SeasonRewardsAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const preview = await previewArenaV2SeasonRewardsAdmin(assertBodyString(req.params?.season_id));
  return res.status(200).json(preview);
};

export const grantArenaV2SeasonRewardsAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await grantArenaV2SeasonRewardsAdmin(
    assertBodyString(req.params?.season_id),
    req.body?.dryRun !== false,
    assertBodyString(req.body?.reason)
  );
  return res.status(200).json(result);
};

export const holdArenaV2RewardGrantAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await holdArenaV2RewardGrantAdmin(assertBodyString(req.params?.grant_id), assertBodyString(req.body?.reason));
  return res.status(200).json(result);
};

export const releaseArenaV2RewardGrantAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await releaseArenaV2RewardGrantAdmin(assertBodyString(req.params?.grant_id));
  return res.status(200).json(result);
};

export const holdArenaV2ReplayAdminController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await createArenaV2ReplayHoldAdmin(
      assertBodyString(req.params?.match_id),
      user.id,
      assertBodyString(req.body?.reason),
      assertBodyString(req.body?.holdUntil) || undefined
    );
    return res.status(201).json(result);
  } catch (err: any) {
    if (String(err?.message || '') === 'ArenaV2MatchNotFound') {
      return res.status(404).json({ error: 'ArenaV2MatchNotFound', message: '매치를 찾을 수 없습니다.' });
    }
    throw err;
  }
};

export const listArenaV2ReportsAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const reports = await listArenaV2ReportsAdmin(status);
  return res.status(200).json({ reports });
};

export const reviewArenaV2ReportAdminController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const status = assertBodyString(req.body?.status) as 'actioned' | 'rejected';
  if (status !== 'actioned' && status !== 'rejected') {
    return res.status(400).json({ error: 'ArenaV2ReportReviewInvalid', message: 'status는 actioned 또는 rejected여야 합니다.' });
  }
  try {
    const report = await reviewArenaV2ReportAdmin(assertBodyString(req.params?.report_id), user.id, status, assertBodyString(req.body?.adminNote));
    return res.status(200).json({ report });
  } catch (err: any) {
    if (String(err?.message || '') === 'ArenaV2ReportNotFound') return res.status(404).json({ error: 'ArenaV2ReportNotFound', message: '신고를 찾을 수 없습니다.' });
    throw err;
  }
};

export const listArenaV2StreamerRightRequestsAdminController = async (req: AuthenticatedRequest, res: Response) => {
  if (!requireUser(req, res)) return;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const requests = await listArenaV2StreamerRightRequestsAdmin(status);
  return res.status(200).json({ requests });
};

export const reviewArenaV2StreamerRightRequestAdminController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const status = assertBodyString(req.body?.status) as 'approved' | 'rejected';
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'ArenaV2RightReviewInvalid', message: 'status는 approved 또는 rejected여야 합니다.' });
  }
  try {
    const request = await reviewArenaV2StreamerRightRequestAdmin(assertBodyString(req.params?.request_id), user.id, status, assertBodyString(req.body?.reviewNote));
    return res.status(200).json({ request });
  } catch (err: any) {
    if (String(err?.message || '') === 'ArenaV2StreamerRightRequestNotFound') return res.status(404).json({ error: 'ArenaV2StreamerRightRequestNotFound', message: '권리 요청을 찾을 수 없습니다.' });
    throw err;
  }
};

export const recordArenaV2OpsFlagAdminController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const flag = assertBodyString(req.params?.flag) || assertBodyString(req.body?.flag);
  if (!flag) {
    return res.status(400).json({ error: 'ArenaV2OpsFlagInvalid', message: 'flag가 필요합니다.' });
  }
  const result = await recordArenaV2OpsFlagAdmin(user.id, flag, req.body?.enabled === true, assertBodyString(req.body?.reason));
  return res.status(200).json(result);
};

export const createArenaV2ReportController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const targetType = assertBodyString(req.body?.targetType) as any;
  const targetId = assertBodyString(req.body?.targetId);
  const reason = assertBodyString(req.body?.reason);
  const allowedTargetTypes = new Set(['card', 'match', 'replay', 'user', 'battle_royale']);

  if (!allowedTargetTypes.has(targetType) || !targetId || !reason) {
    return res.status(400).json({ error: 'ArenaReportInvalid', message: '신고 대상과 사유가 필요합니다.' });
  }

  if (!(await arenaV2TargetExists(targetType, targetId))) {
    return res.status(400).json({ error: 'ArenaReportTargetInvalid', message: '신고 대상을 찾을 수 없습니다.' });
  }

  const report = await createArenaV2Report({
    reporterUserId: user.id,
    targetType,
    targetId,
    reason
  });
  return res.status(201).json({ report });
};

export const listMyArenaV2ReportsController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const reports = await listArenaV2ReportsForUser(user.id);
  return res.status(200).json({ reports });
};

export const createArenaV2StreamerRightRequestController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;

  const streamerId = assertBodyString(req.body?.streamerId);
  const requestType = assertBodyString(req.body?.requestType) as any;
  const allowedRequestTypes = new Set(['opt_out', 'image_change', 'text_change', 'card_config', 'disable_version']);

  if (!streamerId || !allowedRequestTypes.has(requestType)) {
    return res.status(400).json({ error: 'ArenaStreamerRightRequestInvalid', message: 'streamerId와 requestType이 필요합니다.' });
  }

  const ownedStreamer = await streamerRepository.findById(user.id);
  if (!ownedStreamer || ownedStreamer.channel_id !== streamerId) {
    return res.status(403).json({ error: 'ArenaStreamerRightForbidden', message: '해당 스트리머 카드 권리 요청 권한이 없습니다.' });
  }

  const request = await createArenaV2StreamerRightRequest({
    requesterUserId: user.id,
    streamerId,
    requestType,
    payload: req.body?.payload ?? {}
  });
  return res.status(201).json({ request });
};

export const listMyArenaV2StreamerRightRequestsController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const streamerId = typeof req.query.streamerId === 'string' ? req.query.streamerId : undefined;
  const requests = await listArenaV2StreamerRightRequestsForUser(user.id, streamerId);
  return res.status(200).json({ requests });
};

export const getMyArenaV2StreamerCardController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await getMyArenaV2StreamerCard(user.id, typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined);
    return res.status(200).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '현재 아레나 시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaStreamerRightForbidden') return res.status(403).json({ error: message, message: '등록된 스트리머 카드가 없거나 수정 권한이 없습니다.' });
    throw err;
  }
};

export const updateMyArenaV2StreamerCardController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await updateMyArenaV2StreamerCard({
      requesterUserId: user.id,
      displayName: assertBodyString(req.body?.displayName) || undefined,
      cardClass: assertBodyString(req.body?.cardClass),
      cost: Number(req.body?.cost),
      attack: Number(req.body?.attack),
      health: Number(req.body?.health),
      keywords: Array.isArray(req.body?.keywords) ? req.body.keywords : [],
      artAssetId: typeof req.body?.artAssetId === 'string' ? req.body.artAssetId : undefined
    });
    return res.status(result.accepted ? 200 : 422).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '현재 아레나 시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaStreamerRightForbidden') return res.status(403).json({ error: message, message: '등록된 스트리머 카드가 없거나 수정 권한이 없습니다.' });
    if (message === 'ArenaV2StreamerCardImageBanned') return res.status(403).json({ error: message, message: '카드 이미지 수정 권한이 제한된 스트리머입니다.' });
    throw err;
  }
};

export const disableMyArenaV2StreamerCardController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await disableMyArenaV2StreamerCard(user.id);
    return res.status(200).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '현재 아레나 시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaStreamerRightForbidden') return res.status(403).json({ error: message, message: '등록된 스트리머 카드가 없거나 수정 권한이 없습니다.' });
    throw err;
  }
};

export const enableMyArenaV2StreamerCardController = async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await enableMyArenaV2StreamerCard(user.id);
    return res.status(200).json(result);
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message === 'ArenaV2SeasonNotFound') return res.status(404).json({ error: message, message: '현재 아레나 시즌을 찾을 수 없습니다.' });
    if (message === 'ArenaStreamerRightForbidden') return res.status(403).json({ error: message, message: '등록된 스트리머 카드가 없거나 수정 권한이 없습니다.' });
    throw err;
  }
};
