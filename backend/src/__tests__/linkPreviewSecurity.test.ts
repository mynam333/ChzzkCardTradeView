import { EventEmitter } from 'node:events';
import { promises as dns } from 'node:dns';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/db', () => ({
  getDbMode: vi.fn(),
  getMysqlDb: vi.fn(),
  getSqliteDb: vi.fn(),
  getSupabaseClient: vi.fn()
}));

vi.mock('../repositories/mysql/dateUtils', () => ({
  toMysqlDateTime: (value: Date) => value.toISOString()
}));

import {
  buildGenericPreviewFromHtml,
  fetchPinnedPublicResource,
  sanitizeChatLinkPreviewForDelivery,
  type ChatLinkPreview
} from '../services/linkPreviewService';
import { isPublicNetworkAddress, resolvePublicHostname } from '../utils/outboundNetworkSafety';

const invokeLookup = (
  lookup: unknown,
  hostname: string
): Promise<{ address: string; family: number }> => new Promise((resolve, reject) => {
  (lookup as any)(hostname, { family: 0 }, (error: Error | null, address: string, family: number) => {
    if (error) reject(error);
    else resolve({ address, family });
  });
});

describe('link preview outbound-network boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('IPv4와 IPv6의 비공개·특수·문서·전환 대역을 fail-closed로 거부한다', () => {
    const blocked = [
      '0.0.0.1',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '64:ff9b:1::1',
      '100::1',
      '2001::1',
      '2001:db8::1',
      '2002::1',
      '3fff::1',
      'fc00::1',
      'fe80::1',
      'ff02::1'
    ];
    for (const address of blocked) expect(isPublicNetworkAddress(address), address).toBe(false);

    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true);
    expect(isPublicNetworkAddress('93.184.216.34')).toBe(true);
    expect(isPublicNetworkAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('공인 주소와 사설 주소가 섞인 DNS 답변 전체를 거부한다', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ] as any);

    await expect(resolvePublicHostname('mixed.example')).rejects.toMatchObject({
      code: 'UNSAFE_ADDRESS'
    });
  });

  it('각 redirect hop을 다시 해석하고 해당 hop의 검증된 IP로 실제 lookup을 고정한다', async () => {
    const dnsLookup = vi.spyOn(dns, 'lookup').mockImplementation((async (hostname: string) => {
      if (hostname === 'first.example') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'second.example') return [{ address: '1.1.1.1', family: 4 }];
      throw new Error(`unexpected lookup: ${hostname}`);
    }) as any);

    const requestCalls: Array<{ url: URL; options: any }> = [];
    const responses = [
      { status: 302, headers: { location: 'http://second.example/final' }, body: '' },
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<title>safe</title>' }
    ];
    vi.spyOn(http, 'request').mockImplementation(((url: URL, options: any, callback: (response: any) => void) => {
      requestCalls.push({ url, options });
      const spec = responses.shift();
      if (!spec) throw new Error('unexpected request');

      const response = new EventEmitter() as any;
      response.statusCode = spec.status;
      response.headers = spec.headers;
      response.destroy = vi.fn();

      const request = new EventEmitter() as any;
      request.end = () => {
        queueMicrotask(() => {
          callback(response);
          if (spec.status === 200) {
            queueMicrotask(() => {
              response.emit('data', Buffer.from(spec.body));
              response.emit('end');
            });
          }
        });
      };
      return request;
    }) as typeof http.request);

    const result = await fetchPinnedPublicResource(
      'http://first.example/start',
      { 'User-Agent': 'security-test' },
      1024,
      new AbortController().signal
    );

    expect(result.body.toString('utf8')).toBe('<title>safe</title>');
    expect(dnsLookup.mock.calls.map(([hostname]) => hostname)).toEqual([
      'first.example',
      'second.example'
    ]);
    expect(requestCalls.map(({ url }) => url.hostname)).toEqual(['first.example', 'second.example']);
    await expect(invokeLookup(requestCalls[0].options.lookup, 'first.example')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4
    });
    await expect(invokeLookup(requestCalls[1].options.lookup, 'second.example')).resolves.toEqual({
      address: '1.1.1.1',
      family: 4
    });
  });

  it('잘못된 redirect Location은 프로세스 예외가 아니라 요청 실패로 귀속한다', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ] as any);
    vi.spyOn(http, 'request').mockImplementation(((_url: URL, _options: any, callback: (response: any) => void) => {
      const response = new EventEmitter() as any;
      response.statusCode = 302;
      response.headers = { location: 'http://[malformed' };
      response.destroy = vi.fn();

      const request = new EventEmitter() as any;
      request.end = () => queueMicrotask(() => callback(response));
      return request;
    }) as typeof http.request);

    await expect(fetchPinnedPublicResource(
      'http://first.example/start',
      { 'User-Agent': 'security-test' },
      1024,
      new AbortController().signal
    )).rejects.toThrow('InvalidRedirectUrl');
  });

  it.each([
    'http://localhost:3000/admin',
    'http://169.254.169.254/latest/meta-data',
    'https://tracker.example/pixel.gif?recipient=secret',
    'https://public.example/hero.jpg'
  ])('generic preview가 페이지 제공 og:image를 수신자에게 노출하지 않는다: %s', (imageUrl) => {
    const preview = buildGenericPreviewFromHtml(
      'https://public.example/article',
      `<meta property="og:title" content="safe"><meta property="og:image" content="${imageUrl}">`
    );

    expect(preview.image_url).toBeNull();
  });

  it('기존 DB 캐시에 남은 generic tracker image도 전달 전에 제거한다', () => {
    const cached = {
      url: 'https://public.example/article',
      normalized_url: 'https://public.example/article',
      kind: 'link',
      title: 'cached',
      image_url: 'https://tracker.example/pixel.gif',
      fetched_at: '2026-08-01T00:00:00.000Z'
    } satisfies ChatLinkPreview;

    expect(sanitizeChatLinkPreviewForDelivery(cached)).toMatchObject({ image_url: null });
  });

  it('bounded parser가 정상 meta/title을 한 번의 제한된 스캔으로 추출한다', () => {
    const fromMeta = buildGenericPreviewFromHtml(
      'https://public.example/article',
      '<meta content="설명" name="description"><meta content="OG 제목" property="og:title"><title>fallback</title>'
    );
    expect(fromMeta).toMatchObject({ title: 'OG 제목', description: '설명' });

    const fromTitle = buildGenericPreviewFromHtml(
      'https://public.example/article',
      '<html><head><TITLE class="headline">제목 fallback</TITLE></head></html>'
    );
    expect(fromTitle.title).toBe('제목 fallback');
  });

  it('512KB의 미종결·반복 meta/title 입력도 빠르게 fail-closed한다', () => {
    const metaBomb = '<meta'.repeat(Math.floor((512 * 1024) / 5));
    const titleBomb = '<title>'.repeat(Math.floor((512 * 1024) / 7));
    const startedAt = performance.now();

    const metaPreview = buildGenericPreviewFromHtml('https://public.example/meta', metaBomb);
    const titlePreview = buildGenericPreviewFromHtml('https://public.example/title', titleBomb);

    expect(metaPreview.title).toBe('public.example');
    expect(titlePreview.title).toBe('public.example');
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
