import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories', () => ({
  systemConfigRepository: {
    get: vi.fn()
  },
  userRepository: {
    findById: vi.fn()
  }
}));

import { JWT_SECRET } from '../config';
import { maintenanceCheckMiddleware } from '../middlewares/maintenanceCheck';
import { systemConfigRepository, userRepository } from '../repositories';
import { SESSION_COOKIE_NAME } from '../services/sessionCookie';

const systemConfigGet = vi.mocked(systemConfigRepository.get);
const findUserById = vi.mocked(userRepository.findById);

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const runMiddleware = async (request: Partial<Request>) => {
  const response = createResponse();
  const next = vi.fn() as NextFunction;

  await maintenanceCheckMiddleware(request as Request, response, next);

  return { response, next };
};

describe('maintenanceCheckMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemConfigGet.mockImplementation(async (key: string, defaultValue?: string) => {
      if (key === 'maintenance_active') return 'true';
      return defaultValue ?? '';
    });
  });

  it('allows a verified session when the current database role is ADMIN', async () => {
    const token = jwt.sign({ id: 'admin-id', role: 'USER' }, JWT_SECRET);
    findUserById.mockResolvedValue({
      id: 'admin-id',
      role: 'ADMIN'
    } as never);

    const { response, next } = await runMiddleware({
      path: '/admin/stats',
      headers: {},
      cookies: { [SESSION_COOKIE_NAME]: token }
    } as Partial<Request> & { cookies: Record<string, string> });

    expect(findUserById).toHaveBeenCalledWith('admin-id');
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('does not trust an ADMIN role stored only in the JWT', async () => {
    const token = jwt.sign({ id: 'user-id', role: 'ADMIN' }, JWT_SECRET);
    findUserById.mockResolvedValue({
      id: 'user-id',
      role: 'USER'
    } as never);

    const { response, next } = await runMiddleware({
      path: '/admin/stats',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Maintenance'
    }));
  });

  it('blocks unauthenticated requests while maintenance is active', async () => {
    const { response, next } = await runMiddleware({
      path: '/rankings',
      headers: {}
    });

    expect(findUserById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('allows requests when maintenance is inactive', async () => {
    systemConfigGet.mockResolvedValueOnce('false');

    const { response, next } = await runMiddleware({
      path: '/rankings',
      headers: {}
    });

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('always allows maintenance status checks', async () => {
    const { response, next } = await runMiddleware({
      path: '/maintenance/status',
      headers: {}
    });

    expect(systemConfigGet).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});
