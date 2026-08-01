import { EventEmitter } from 'events';
import { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories', () => ({
  userRepository: { findById: vi.fn() }
}));

vi.mock('../services/authSessionService', () => ({
  verifyAuthSessionToken: vi.fn()
}));

import { userRepository } from '../repositories';
import { verifyAuthSessionToken } from '../services/authSessionService';
import {
  __resetNotificationStreamsForTest,
  publishNotification,
  subscribeNotificationStream
} from '../services/notificationStream';

const findUser = vi.mocked(userRepository.findById);
const verifySession = vi.mocked(verifyAuthSessionToken);

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableLength = 0;
  acceptsWrites = true;
  writes: string[] = [];
  statusCode: number | null = null;
  jsonBody: unknown = null;
  writeHead = vi.fn();
  flushHeaders = vi.fn();
  write = vi.fn((chunk: string) => {
    this.writes.push(String(chunk));
    return this.acceptsWrites;
  });
  status = vi.fn((statusCode: number) => {
    this.statusCode = statusCode;
    return this;
  });
  json = vi.fn((body: unknown) => {
    this.jsonBody = body;
    return this;
  });
  destroy = vi.fn(() => {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('close');
    }
    return this;
  });
}

const asResponse = (res: FakeResponse) => res as unknown as Response;
const notification = {
  id: 1,
  user_id: 'user-1',
  title: '보안 알림',
  body: 'test',
  link: null,
  is_read: false
};

describe('notification stream session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    verifySession.mockResolvedValue({ id: 'user-1', role: 'USER' } as never);
    findUser.mockResolvedValue({ id: 'user-1', banned_until: null } as never);
  });

  afterEach(() => {
    __resetNotificationStreamsForTest();
    vi.useRealTimers();
  });

  it('closes a revoked session and does not deliver later notifications', async () => {
    const response = new FakeResponse();
    subscribeNotificationStream('user-1', 'revoked-token', asResponse(response));
    publishNotification(notification);
    expect(response.writes.some((value) => value.includes('event: notification'))).toBe(true);

    verifySession.mockRejectedValue(new Error('InvalidAuthSession'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(response.destroy).toHaveBeenCalled();
    const writesAfterClose = response.writes.length;
    publishNotification({ ...notification, id: 2 });
    expect(response.writes).toHaveLength(writesAfterClose);
  });

  it('closes the stream when the current user was deleted or banned', async () => {
    const deletedResponse = new FakeResponse();
    subscribeNotificationStream('user-1', 'deleted-user-token', asResponse(deletedResponse));
    findUser.mockResolvedValueOnce(null);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(deletedResponse.destroy).toHaveBeenCalled();

    const bannedResponse = new FakeResponse();
    subscribeNotificationStream('user-1', 'banned-user-token', asResponse(bannedResponse));
    findUser.mockResolvedValueOnce({
      id: 'user-1',
      banned_until: new Date(Date.now() + 60_000).toISOString()
    } as never);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(bannedResponse.destroy).toHaveBeenCalled();
  });

  it('fails closed when the current-user lookup does not settle', async () => {
    const response = new FakeResponse();
    subscribeNotificationStream('user-1', 'hanging-user-lookup-token', asResponse(response));
    findUser.mockReturnValueOnce(new Promise(() => undefined));

    await vi.advanceTimersByTimeAsync(28_000);

    expect(response.destroy).toHaveBeenCalled();
    const writesAfterClose = response.writes.length;
    publishNotification({ ...notification, id: 3 });
    expect(response.writes).toHaveLength(writesAfterClose);
  });

  it('caps concurrent streams for one account', () => {
    const responses = Array.from({ length: 4 }, () => new FakeResponse());
    for (const response of responses) {
      subscribeNotificationStream('user-1', 'active-token', asResponse(response));
    }

    expect(responses.slice(0, 3).every((response) => response.writeHead.mock.calls.length === 1)).toBe(true);
    expect(responses[3].statusCode).toBe(429);
    expect(responses[3].writeHead).not.toHaveBeenCalled();
  });

  it('drops a slow client instead of growing the SSE output queue', () => {
    const response = new FakeResponse();
    response.writableLength = 300 * 1024;

    subscribeNotificationStream('user-1', 'active-token', asResponse(response));

    expect(response.destroy).toHaveBeenCalled();
    const writesAfterClose = response.writes.length;
    publishNotification({ ...notification, id: 4 });
    expect(response.writes).toHaveLength(writesAfterClose);
  });
});
