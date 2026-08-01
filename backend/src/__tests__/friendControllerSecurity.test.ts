import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processAttachment: vi.fn(),
  deleteProcessed: vi.fn(),
  reserveQuota: vi.fn(),
  commitQuota: vi.fn(),
  releaseQuota: vi.fn(),
  findReusable: vi.fn(),
  deleteSavedAttachment: vi.fn(),
  getRoomForUser: vi.fn(),
  sendChatMessage: vi.fn(),
  sendAttachmentMessage: vi.fn()
}));

vi.mock('../repositories', () => ({
  userRepository: { searchByUsername: vi.fn() }
}));

vi.mock('../services/notificationDelivery', () => ({
  createRealtimeNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../controllers/pushController', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/chatPresence', () => ({
  clearChatRoomViewing: vi.fn(),
  isChatRoomViewing: vi.fn(() => true),
  markChatRoomViewing: vi.fn()
}));

vi.mock('../services/chatAttachmentService', () => {
  class ChatAttachmentProcessingOverloadedError extends Error {
    readonly code = 'ChatAttachmentProcessingOverloaded';
    readonly retryAfterSeconds = 2;
    constructor(readonly reason: string) {
      super('ChatAttachmentProcessingOverloaded');
      this.name = 'ChatAttachmentProcessingOverloadedError';
    }
  }
  return {
    CHAT_ATTACHMENT_MAX_ACTIVE_BYTES: 100 * 1024 * 1024,
    ChatAttachmentProcessingOverloadedError,
    deleteProcessedChatAttachment: mocks.deleteProcessed,
    getChatAttachmentSourceHash: vi.fn(() => 'source-hash'),
    processChatImageAttachment: mocks.processAttachment
  };
});

vi.mock('../services/chatAttachmentQuotaService', () => {
  class ChatAttachmentLimitExceededError extends Error {
    readonly code = 'ChatAttachmentLimitExceeded';
    constructor() {
      super('ChatAttachmentLimitExceeded');
      this.name = 'ChatAttachmentLimitExceededError';
    }
  }
  class ChatAttachmentQuotaReservationExpiredError extends Error {
    readonly code = 'ChatAttachmentQuotaReservationExpired';
    readonly retryAfterSeconds = 2;
    constructor() {
      super('ChatAttachmentQuotaReservationExpired');
      this.name = 'ChatAttachmentQuotaReservationExpiredError';
    }
  }
  return {
    ChatAttachmentLimitExceededError,
    ChatAttachmentQuotaReservationExpiredError,
    reserveChatAttachmentQuota: mocks.reserveQuota,
    commitChatAttachmentQuotaReservation: mocks.commitQuota,
    releaseChatAttachmentQuotaReservation: mocks.releaseQuota
  };
});

vi.mock('../services/friendChatService', () => ({
  cancelFriendRequest: vi.fn(),
  createFriendRequest: vi.fn(),
  deleteSavedChatAttachment: mocks.deleteSavedAttachment,
  findReusableChatAttachment: mocks.findReusable,
  getOrCreateChatRoom: vi.fn(),
  getReusableChatAttachmentById: vi.fn(),
  getRoomForUser: mocks.getRoomForUser,
  getUserSummary: vi.fn(),
  hideClosedChatRoom: vi.fn(),
  listRecentChatAttachments: vi.fn(),
  listChatRooms: vi.fn(),
  listFriendRequests: vi.fn(),
  listFriends: vi.fn(),
  listMessages: vi.fn(),
  markRoomMessagesRead: vi.fn(),
  removeFriend: vi.fn(),
  respondFriendRequest: vi.fn(),
  sendChatAttachmentMessage: mocks.sendAttachmentMessage,
  sendChatMessage: mocks.sendChatMessage,
  setChatRoomClosed: vi.fn(),
  setChatRoomMuted: vi.fn()
}));

import { ChatAttachmentProcessingOverloadedError } from '../services/chatAttachmentService';
import { createChatImageMessage, createChatMessage } from '../controllers/friendController';

const room = {
  id: 7,
  user_a_id: 'user-1',
  user_b_id: 'user-2',
  muted_for_a: false,
  muted_for_b: false
};

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const imageRequest = () => ({
  user: { id: 'user-1', username: 'user-1' },
  params: { room_id: '7' },
  body: {},
  file: {
    buffer: Buffer.from('image'),
    size: 5,
    mimetype: 'image/png',
    originalname: 'image.png'
  }
}) as any;

describe('friendController security error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoomForUser.mockResolvedValue(room);
    mocks.findReusable.mockResolvedValue(null);
    mocks.reserveQuota.mockResolvedValue('reservation-1');
    mocks.releaseQuota.mockResolvedValue(undefined);
    mocks.sendAttachmentMessage.mockResolvedValue({ message: { id: 1 } });
  });

  it('releases quota and returns retryable 503 when image processing admission is full', async () => {
    mocks.processAttachment.mockRejectedValue(new ChatAttachmentProcessingOverloadedError('pending_jobs'));
    const response = createResponse();

    await createChatImageMessage(imageRequest(), response);

    expect(mocks.reserveQuota).toHaveBeenCalledWith('user-1', 5, 100 * 1024 * 1024);
    expect(mocks.releaseQuota).toHaveBeenCalledWith('user-1', 'reservation-1');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'ChatAttachmentProcessingOverloaded'
    }));
  });

  it('maps the transactional friendship check to 403 for ordinary HTTP sends', async () => {
    mocks.sendChatMessage.mockRejectedValue(new Error('FriendsOnly'));
    const response = createResponse();

    await createChatMessage({
      user: { id: 'user-1', username: 'user-1' },
      params: { room_id: '7' },
      body: { body: 'hello' }
    } as any, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FriendsOnly' }));
  });

  it('keeps a legitimate image send working after reserving and resizing quota', async () => {
    const processed = {
      url: '/uploads/chat/processed.webp',
      mime: 'image/webp',
      sizeBytes: 4,
      width: 10,
      height: 10,
      expiresAt: new Date('2026-08-08T00:00:00.000Z'),
      sourceHash: 'source-hash'
    };
    const saved = { ...processed, attachmentId: 11, reused: false };
    mocks.processAttachment.mockResolvedValue(processed);
    mocks.findReusable.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.commitQuota.mockResolvedValue({
      attachment: saved,
      discardProcessedFile: false,
      previousUrlToDelete: null
    });
    const response = createResponse();

    await createChatImageMessage(imageRequest(), response);

    expect(mocks.commitQuota).toHaveBeenCalledWith('user-1', 'reservation-1', 'source-hash', processed, 100 * 1024 * 1024);
    expect(mocks.releaseQuota).not.toHaveBeenCalled();
    expect(mocks.sendAttachmentMessage).toHaveBeenCalledWith(7, 'user-1', saved, true);
    expect(response.status).toHaveBeenCalledWith(201);

    const order = [
      mocks.reserveQuota.mock.invocationCallOrder[0],
      mocks.processAttachment.mock.invocationCallOrder[0],
      mocks.commitQuota.mock.invocationCallOrder[0],
      mocks.sendAttachmentMessage.mock.invocationCallOrder[0]
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
