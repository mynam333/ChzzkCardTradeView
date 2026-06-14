import { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedRequest } from '../middlewares/admin';
import type { Trade, User } from '../repositories/interfaces';

vi.mock('../repositories', () => ({
  tradeRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    confirm: vi.fn(),
    finalize: vi.fn(),
    findActiveByUser: vi.fn()
  },
  userRepository: {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    isBlocked: vi.fn()
  },
  userCardRepository: {
    findByUserId: vi.fn()
  },
  notificationRepository: {
    create: vi.fn()
  },
  marketRepository: {
    listByUser: vi.fn()
  }
}));

vi.mock('../controllers/pushController', () => ({
  sendPushToUser: vi.fn()
}));

import { confirmTrade, createTrade, finalizeTrade } from '../controllers/tradeController';
import { marketRepository, notificationRepository, tradeRepository, userCardRepository, userRepository } from '../repositories';

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const oldCreatedAt = () => new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const makeUser = (id: string, createdAt: string): User => ({
  id,
  username: `user_${id}`,
  avatar_url: null,
  role: 'USER',
  point: 10000,
  last_free_draw: null,
  banned_until: null,
  created_at: createdAt
});

const makeTrade = (status: Trade['status']): Trade => ({
  id: 1,
  sender_id: 'sender',
  receiver_id: 'receiver',
  sender_offer: { cards: [], point: 100 },
  receiver_offer: { cards: [], point: 0 },
  status
});

const mockUsersById = (users: Record<string, User>) => {
  vi.mocked(userRepository.findById).mockImplementation(async (id: string) => users[id] || null);
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('trade account age restriction', () => {
  it('blocks creating a trade when the sender account is younger than 24 hours', async () => {
    const sender = makeUser('sender', recentCreatedAt());
    const receiver = makeUser('receiver', oldCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(userRepository.isBlocked).mockResolvedValue(false);

    const response = createResponse();
    await createTrade({
      user: sender,
      body: {
        receiver_id: 'receiver',
        sender_offer: { cards: [], point: 100 },
        receiver_offer: { cards: [], point: 0 }
      }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(vi.mocked(response.json).mock.calls[0][0]).toEqual(expect.objectContaining({
      error: 'TradeAccountTooNew',
      reason: 'ACCOUNT_TOO_NEW'
    }));
    expect(tradeRepository.create).not.toHaveBeenCalled();
  });

  it('blocks creating a trade when the receiver account is younger than 24 hours', async () => {
    const sender = makeUser('sender', oldCreatedAt());
    const receiver = makeUser('receiver', recentCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(userRepository.isBlocked).mockResolvedValue(false);

    const response = createResponse();
    await createTrade({
      user: sender,
      body: {
        receiver_id: 'receiver',
        sender_offer: { cards: [], point: 100 },
        receiver_offer: { cards: [], point: 0 }
      }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(vi.mocked(response.json).mock.calls[0][0]).toEqual(expect.objectContaining({
      error: 'TradeAccountTooNew',
      reason: 'ACCOUNT_TOO_NEW'
    }));
    expect(tradeRepository.create).not.toHaveBeenCalled();
  });

  it('blocks receiver confirmation for an existing trade while either account is too new', async () => {
    const sender = makeUser('sender', oldCreatedAt());
    const receiver = makeUser('receiver', recentCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(tradeRepository.findById).mockResolvedValue(makeTrade('PENDING'));

    const response = createResponse();
    await confirmTrade({
      user: receiver,
      params: { trade_id: '1' }
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(tradeRepository.confirm).not.toHaveBeenCalled();
  });

  it('blocks finalizing an existing trade while either account is too new', async () => {
    const sender = makeUser('sender', oldCreatedAt());
    const receiver = makeUser('receiver', recentCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(tradeRepository.findById).mockResolvedValue(makeTrade('CONFIRMED'));

    const response = createResponse();
    await finalizeTrade({
      user: sender,
      params: { trade_id: '1' }
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(tradeRepository.finalize).not.toHaveBeenCalled();
  });

  it('allows confirmation when both accounts are older than 24 hours', async () => {
    const sender = makeUser('sender', oldCreatedAt());
    const receiver = makeUser('receiver', oldCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(tradeRepository.findById).mockResolvedValue(makeTrade('PENDING'));
    vi.mocked(tradeRepository.confirm).mockResolvedValue({ ok: true, reason: 'OK' });
    vi.mocked(notificationRepository.create).mockResolvedValue({} as never);
    vi.mocked(userCardRepository.findByUserId).mockResolvedValue([]);
    vi.mocked(marketRepository.listByUser).mockResolvedValue([]);

    const response = createResponse();
    await confirmTrade({
      user: receiver,
      params: { trade_id: '1' }
    } as unknown as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(tradeRepository.confirm).toHaveBeenCalledWith(1, 'receiver');
  });

  it('blocks creating a trade that requests a receiver card listed on the market', async () => {
    const sender = makeUser('sender', oldCreatedAt());
    const receiver = makeUser('receiver', oldCreatedAt());
    mockUsersById({ sender, receiver });
    vi.mocked(userRepository.isBlocked).mockResolvedValue(false);
    vi.mocked(tradeRepository.findActiveByUser).mockResolvedValue([]);
    vi.mocked(userCardRepository.findByUserId).mockImplementation(async (userId: string) => {
      if (userId === 'receiver') {
        return [{
          id: 10,
          user_id: 'receiver',
          channel_id: 'channel-a',
          serial_number: 1,
          star: 0,
          streamer: { channel_id: 'channel-a', name: '스트리머A', logo_url: null }
        }] as never;
      }
      return [] as never;
    });
    vi.mocked(marketRepository.listByUser).mockImplementation(async (userId: string) => {
      if (userId === 'receiver') {
        return [{
          id: 99,
          seller_id: 'receiver',
          user_card_id: 10,
          price: 1000,
          status: 'PENDING',
          buyer_id: null,
          fee: 0,
          settled_amount: 0,
          card: { channel_id: 'channel-a', star: 0 }
        }] as never;
      }
      return [] as never;
    });

    const response = createResponse();
    await createTrade({
      user: sender,
      body: {
        receiver_id: 'receiver',
        sender_offer: { cards: [], point: 100 },
        receiver_offer: { cards: [{ channel_id: 'channel-a', star: 0, count: 1 }], point: 0 }
      }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(vi.mocked(response.json).mock.calls[0][0]).toEqual(expect.objectContaining({
      error: 'InsufficientCards',
      reason: 'RECEIVER_CARDS_UNAVAILABLE'
    }));
    expect(tradeRepository.create).not.toHaveBeenCalled();
  });
});
