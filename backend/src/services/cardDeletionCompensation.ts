import {
  systemConfigRepository,
  userRepository
} from '../repositories';
import type { Streamer } from '../repositories/interfaces';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';

export type DeletedCardCompensationTarget = {
  user_id: string;
  star?: number | null;
};

export type CardDeletionUserCompensation = {
  user_id: string;
  deleted_count: number;
  point_refund: number;
  free_draw_tickets: number;
  high_value_cards: number;
  ticket_compensated_cards: number;
};

export type CardDeletionCompensationResult = {
  draw_cost: number;
  affected_users: number;
  cards_removed: number;
  total_point_refunded: number;
  total_free_draw_tickets_granted: number;
  high_value_cards_refunded: number;
  ticket_compensated_cards: number;
  users: CardDeletionUserCompensation[];
};

const normalizeStar = (star?: number | null) => Math.max(0, Math.min(5, Math.trunc(Number(star || 0))));

export const calculateDeletedCardValue = (streamer: Pick<Streamer, 'base_value'>, star?: number | null): number => {
  const baseValue = Math.max(0, Math.round(Number(streamer.base_value || 0)));
  return Math.round(baseValue * (1 + normalizeStar(star) * 0.8));
};

const getCurrentDrawCost = async (): Promise<number> => {
  const raw = await systemConfigRepository.get('draw_cost', '10000');
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10000;
};

export const formatCardDeletionCompensationSummary = (result: Pick<CardDeletionCompensationResult, 'total_point_refunded' | 'total_free_draw_tickets_granted'>): string => {
  const parts: string[] = [];
  if (result.total_point_refunded > 0) {
    parts.push(`포인트 ${result.total_point_refunded.toLocaleString()} P`);
  }
  if (result.total_free_draw_tickets_granted > 0) {
    parts.push(`무료 소환 티켓 ${result.total_free_draw_tickets_granted.toLocaleString()}장`);
  }
  return parts.length > 0 ? parts.join(', ') : '없음';
};

export const formatCardDeletionCompensationReward = (compensation: CardDeletionUserCompensation): string => {
  const parts: string[] = [];
  if (compensation.point_refund > 0) {
    parts.push(`카드 가치가 높은 ${compensation.high_value_cards.toLocaleString()}장 보상 ${compensation.point_refund.toLocaleString()} P`);
  }
  if (compensation.free_draw_tickets > 0) {
    parts.push(`추가 무료 소환 티켓 ${compensation.free_draw_tickets.toLocaleString()}장`);
  }
  return parts.join('와 ');
};

export const formatCardDeletionCompensationBody = (
  streamerName: string,
  compensation: CardDeletionUserCompensation
): string => {
  const deletedCount = compensation.deleted_count.toLocaleString();
  return `'${streamerName}' 카드 ${deletedCount}장이 삭제되어 ${formatCardDeletionCompensationReward(compensation)}이 지급되었습니다.`;
};

const grantPointRefund = async (
  userId: string,
  amount: number,
  metadata: Record<string, unknown>
): Promise<void> => {
  if (!userId || amount <= 0) return;

  const sourceType = 'card_delete_refund';
  const reason = 'card_delete_refund';
  const description = '카드 삭제 보상 포인트 환불';

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().transaction(async (tx) => {
      await tx.run('UPDATE users SET point = point + ? WHERE id = ?', amount, userId);
      await recordMysqlPointLedger(tx, {
        userId,
        amount,
        sourceType,
        sourceId: metadata.channel_id == null ? null : String(metadata.channel_id),
        reason,
        description,
        metadata
      });
    });
    return;
  }

  if (getDbMode() === 'SUPABASE') {
    await userRepository.incrementPoint(userId, amount);
    const user = await userRepository.findById(userId).catch(() => null);
    const { error } = await getSupabaseClient()
      .from('point_ledger_entries')
      .insert({
        user_id: userId,
        counterparty_user_id: null,
        amount,
        balance_after: user?.point ?? null,
        source_type: sourceType,
        source_id: metadata.channel_id == null ? null : String(metadata.channel_id),
        reason,
        description,
        metadata
      });
    if (error) throw error;
    return;
  }

  const db = getSqliteDb();
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(amount, userId);
    recordSqlitePointLedger(db, {
      userId,
      amount,
      sourceType,
      sourceId: metadata.channel_id == null ? null : String(metadata.channel_id),
      reason,
      description,
      metadata
    });
  });
  tx();
};

export const grantCardDeletionCompensations = async (
  streamer: Streamer,
  cards: DeletedCardCompensationTarget[]
): Promise<CardDeletionCompensationResult> => {
  const drawCost = await getCurrentDrawCost();
  const byUser = new Map<string, CardDeletionUserCompensation>();

  for (const card of cards) {
    if (!card.user_id) continue;
    const current = byUser.get(card.user_id) || {
      user_id: card.user_id,
      deleted_count: 0,
      point_refund: 0,
      free_draw_tickets: 0,
      high_value_cards: 0,
      ticket_compensated_cards: 0
    };
    current.deleted_count += 1;
    const value = calculateDeletedCardValue(streamer, card.star);
    if (value > drawCost) {
      current.point_refund += value;
      current.high_value_cards += 1;
    } else {
      current.ticket_compensated_cards += 1;
    }
    byUser.set(card.user_id, current);
  }

  const users = [...byUser.values()].map((compensation) => ({
    ...compensation,
    free_draw_tickets: compensation.ticket_compensated_cards > 0 ? 1 : 0
  }));

  for (const compensation of users) {
    if (compensation.free_draw_tickets > 0) {
      await userRepository.addBonusFreeDrawTickets(compensation.user_id, compensation.free_draw_tickets);
    }
    if (compensation.point_refund > 0) {
      await grantPointRefund(compensation.user_id, compensation.point_refund, {
        channel_id: streamer.channel_id,
        streamer_name: streamer.name,
        draw_cost: drawCost,
        deleted_count: compensation.deleted_count,
        high_value_cards: compensation.high_value_cards,
        ticket_compensated_cards: compensation.ticket_compensated_cards
      });
    }
  }

  return {
    draw_cost: drawCost,
    affected_users: users.length,
    cards_removed: cards.length,
    total_point_refunded: users.reduce((sum, item) => sum + item.point_refund, 0),
    total_free_draw_tickets_granted: users.reduce((sum, item) => sum + item.free_draw_tickets, 0),
    high_value_cards_refunded: users.reduce((sum, item) => sum + item.high_value_cards, 0),
    ticket_compensated_cards: users.reduce((sum, item) => sum + item.ticket_compensated_cards, 0),
    users
  };
};
