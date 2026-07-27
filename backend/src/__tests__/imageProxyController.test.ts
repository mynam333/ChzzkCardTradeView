import { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyImage } from '../controllers/imageProxyController';

const imageResponse = (bytes = [137, 80, 78, 71]) => {
  const body = Uint8Array.from(bytes);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return 'image/png';
        if (name.toLowerCase() === 'content-length') return String(body.byteLength);
        return null;
      }
    },
    body: null,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  } as unknown as globalThis.Response;
};

const failedResponse = (status = 503) => ({
  ok: false,
  status,
  headers: { get: () => null },
  body: null,
  arrayBuffer: async () => new ArrayBuffer(0)
}) as unknown as globalThis.Response;

const createRequest = (url: string, query: Record<string, string> = {}) => ({
  query: { url, ...query }
}) as unknown as Request;

const createResponse = () => {
  const headers = new Map<string, string>();
  const response: any = {
    statusCode: 200,
    body: undefined,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), String(value));
      return response;
    }),
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    send: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    getHeader: (name: string) => headers.get(name.toLowerCase())
  };
  return response as Response & {
    statusCode: number;
    body: unknown;
    getHeader(name: string): string | undefined;
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image proxy retry cache contract', () => {
  it('deduplicates simultaneous canonical and retry requests through one upstream fetch', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-mixed-retry';
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return imageResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const canonicalResponse = createResponse();
    const retryResponse = createResponse();
    const canonicalRequest = proxyImage(createRequest(url), canonicalResponse);
    const retryRequest = proxyImage(createRequest(url, { retry: '1' }), retryResponse);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseFetch();
    await Promise.all([canonicalRequest, retryRequest]);

    expect(canonicalResponse.statusCode).toBe(200);
    expect(retryResponse.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets retry bypass a canonical negative cache and publishes success to the canonical cache', async () => {
    const url = 'https://api.dicebear.com/9.x/shapes/png?seed=proxy-negative-recovery';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse())
      .mockResolvedValueOnce(imageResponse([1, 2, 3, 4]));
    vi.stubGlobal('fetch', fetchMock);

    const initialFailure = createResponse();
    await proxyImage(createRequest(url), initialFailure);
    expect(initialFailure.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cachedFailure = createResponse();
    await proxyImage(createRequest(url), cachedFailure);
    expect(cachedFailure.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retrySuccess = createResponse();
    await proxyImage(createRequest(url, { retry: '1' }), retrySuccess);
    expect(retrySuccess.statusCode).toBe(200);
    expect(retrySuccess.getHeader('X-Image-Proxy-Cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const canonicalHit = createResponse();
    await proxyImage(createRequest(url), canonicalHit);
    expect(canonicalHit.statusCode).toBe(200);
    expect(canonicalHit.getHeader('X-Image-Proxy-Cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the allow-listed pstatic original when its resize derivative fails', async () => {
    const url = 'https://ssl.pstatic.net/static/chikapo/proxy-fallback.png';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(404))
      .mockResolvedValueOnce(imageResponse([10, 20, 30, 40]));
    vi.stubGlobal('fetch', fetchMock);

    const response = createResponse();
    await proxyImage(createRequest(url, { w: '240', q: '82' }), response);

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('type=f240_240_na');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(url);
  });
});
