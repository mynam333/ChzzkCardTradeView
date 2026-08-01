import { promises as dns } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPinnedLookup,
  isPublicNetworkAddress,
  resolvePublicHostname,
  validateSafeOutboundUrl
} from '../utils/outboundNetworkSafety';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('outbound network safety', () => {
  it('allows public unicast IPv4 and IPv6 addresses', () => {
    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true);
    expect(isPublicNetworkAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicNetworkAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '198.51.100.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '3fff::1'
  ])('rejects non-public or reserved address %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it('rejects a mixed public/private DNS answer as a unit', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 }
    ] as any);

    await expect(resolvePublicHostname('cdn.example.com')).rejects.toMatchObject({
      code: 'UNSAFE_ADDRESS'
    });
  });

  it('rejects localhost and credentials before performing DNS', async () => {
    const lookupSpy = vi.spyOn(dns, 'lookup');
    await expect(validateSafeOutboundUrl('https://localhost/private')).rejects.toMatchObject({
      code: 'UNSAFE_HOST'
    });
    await expect(validateSafeOutboundUrl('https://user:secret@example.com/private')).rejects.toMatchObject({
      code: 'URL_CREDENTIALS'
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('pins only the validated address set and expected hostname', async () => {
    const lookup = createPinnedLookup('cdn.example.com', [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 }
    ]);

    const ipv6 = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('cdn.example.com', { family: 6, all: false }, (error, address, family) => {
        if (error) return reject(error);
        resolve({ address: String(address), family: Number(family) });
      });
    });
    expect(ipv6).toEqual({ address: '2606:4700:4700::1111', family: 6 });

    await expect(new Promise((resolve, reject) => {
      lookup('attacker.example', { family: 4, all: false }, (error, address) => {
        if (error) return reject(error);
        resolve(address);
      });
    })).rejects.toMatchObject({ code: 'EACCES' });
  });
});
