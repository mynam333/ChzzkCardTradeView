import { promises as dns } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import net, { type LookupFunction } from 'node:net';

export type ValidatedNetworkAddress = {
  address: string;
  family: 4 | 6;
};

export type OutboundHostValidationCache = Map<string, Promise<ValidatedNetworkAddress[]>>;

export class OutboundNetworkSafetyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OutboundNetworkSafetyError';
  }
}

const DEFAULT_DNS_TIMEOUT_MS = 2_000;

const normalizeHostname = (hostname: string): string => (
  hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
);

const ipv4ToNumber = (address: string): number | null => {
  const octets = address.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const parsed = Number(octet);
    if (parsed < 0 || parsed > 255) return null;
    value = ((value << 8) | parsed) >>> 0;
  }
  return value;
};

const ipv4InCidr = (value: number, base: number, prefix: number): boolean => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
};

const NON_PUBLIC_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],   // current network / unspecified
  [0x0a000000, 8],   // RFC1918
  [0x64400000, 10],  // carrier-grade NAT
  [0x7f000000, 8],   // loopback
  [0xa9fe0000, 16],  // link-local, including cloud metadata endpoints
  [0xac100000, 12],  // RFC1918
  [0xc0000000, 24],  // IETF protocol assignments
  [0xc0000200, 24],  // TEST-NET-1
  [0xc0586300, 24],  // deprecated 6to4 relay anycast
  [0xc0a80000, 16],  // RFC1918
  [0xc6120000, 15],  // benchmarking
  [0xc6336400, 24],  // TEST-NET-2
  [0xcb007100, 24],  // TEST-NET-3
  [0xe0000000, 4],   // multicast
  [0xf0000000, 4]    // reserved / broadcast
];

const parseIpv6 = (input: string): bigint | null => {
  let address = normalizeHostname(input).split('%', 1)[0];
  if (net.isIP(address) !== 6) return null;

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4 = ipv4ToNumber(address.slice(lastColon + 1));
    if (ipv4 === null) return null;
    address = `${address.slice(0, lastColon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;

  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
};

const ipv6InCidr = (value: bigint, base: bigint, prefix: number): boolean => {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
};

const IPV6_GLOBAL_UNICAST_BASE = 0x20000000000000000000000000000000n;
const IPV6_DOCUMENTATION_BASE = 0x20010db8000000000000000000000000n;
const IPV6_SPECIAL_ASSIGNMENTS_BASE = 0x20010000000000000000000000000000n;
const IPV6_6TO4_BASE = 0x20020000000000000000000000000000n;
const IPV6_DOCUMENTATION_V2_BASE = 0x3fff0000000000000000000000000000n;
const IPV6_NAT64_BASE = 0x0064ff9b000000000000000000000000n;
const IPV6_NAT64_LOCAL_BASE = 0x0064ff9b000100000000000000000000n;

/**
 * Returns true only for routable unicast addresses. Private, loopback,
 * link-local, multicast, documentation, benchmark, transition and reserved
 * ranges fail closed.
 */
export const isPublicNetworkAddress = (input: string): boolean => {
  const address = normalizeHostname(input).split('%', 1)[0];
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToNumber(address);
    return value !== null && !NON_PUBLIC_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (family !== 6) return false;

  const value = parseIpv6(address);
  if (value === null) return false;

  // IPv4-compatible and IPv4-mapped IPv6 addresses inherit the embedded
  // address policy (for example ::ffff:127.0.0.1).
  const high96 = value >> 32n;
  if (high96 === 0n || high96 === 0xffffn) {
    const embedded = Number(value & 0xffffffffn);
    return !NON_PUBLIC_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(embedded, base, prefix));
  }

  // The well-known NAT64 prefix is safe only when its embedded IPv4 address
  // is public. The local-use NAT64 prefix is not accepted.
  if (ipv6InCidr(value, IPV6_NAT64_LOCAL_BASE, 48)) return false;
  if (ipv6InCidr(value, IPV6_NAT64_BASE, 96)) {
    const embedded = Number(value & 0xffffffffn);
    return !NON_PUBLIC_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(embedded, base, prefix));
  }

  if (!ipv6InCidr(value, IPV6_GLOBAL_UNICAST_BASE, 3)) return false;
  if (ipv6InCidr(value, IPV6_SPECIAL_ASSIGNMENTS_BASE, 23)) return false;
  if (ipv6InCidr(value, IPV6_DOCUMENTATION_BASE, 32)) return false;
  if (ipv6InCidr(value, IPV6_6TO4_BASE, 16)) return false;
  if (ipv6InCidr(value, IPV6_DOCUMENTATION_V2_BASE, 20)) return false;
  return true;
};

const isLocalHostname = (hostname: string): boolean => (
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === 'local' ||
  hostname.endsWith('.local') ||
  hostname.endsWith('.internal') ||
  hostname === 'home.arpa' ||
  hostname.endsWith('.home.arpa')
);

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new OutboundNetworkSafetyError('DNS_TIMEOUT', 'DNS lookup timed out'));
        }, Math.max(1, timeoutMs));
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const normalizeLookupAddresses = (records: LookupAddress[]): ValidatedNetworkAddress[] => {
  const unique = new Map<string, ValidatedNetworkAddress>();
  for (const record of records) {
    const address = normalizeHostname(record.address).split('%', 1)[0];
    const family = net.isIP(address);
    if (family !== 4 && family !== 6) {
      throw new OutboundNetworkSafetyError('UNSAFE_ADDRESS', 'DNS returned an invalid address');
    }
    if (!isPublicNetworkAddress(address)) {
      throw new OutboundNetworkSafetyError('UNSAFE_ADDRESS', 'DNS returned a non-public address');
    }
    unique.set(`${family}:${address}`, { address, family });
  }
  if (unique.size === 0) {
    throw new OutboundNetworkSafetyError('DNS_NO_ADDRESS', 'DNS returned no usable address');
  }
  return [...unique.values()];
};

export const resolvePublicHostname = async (
  rawHostname: string,
  options: { timeoutMs?: number; cache?: OutboundHostValidationCache } = {}
): Promise<ValidatedNetworkAddress[]> => {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname || isLocalHostname(hostname)) {
    throw new OutboundNetworkSafetyError('UNSAFE_HOST', 'Local hostnames are not allowed');
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicNetworkAddress(hostname)) {
      throw new OutboundNetworkSafetyError('UNSAFE_ADDRESS', 'Non-public addresses are not allowed');
    }
    return [{ address: hostname, family: literalFamily }];
  }

  const existing = options.cache?.get(hostname);
  if (existing) return existing;

  const resolution = (async () => {
    let records: LookupAddress[];
    try {
      records = await withTimeout(
        dns.lookup(hostname, { all: true, verbatim: true }),
        options.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS
      );
    } catch (error) {
      if (error instanceof OutboundNetworkSafetyError) throw error;
      throw new OutboundNetworkSafetyError('DNS_LOOKUP_FAILED', 'DNS lookup failed');
    }
    // Reject the entire answer when any address is unsafe. This prevents the
    // network client from selecting a private answer from a mixed DNS result.
    return normalizeLookupAddresses(records);
  })();
  options.cache?.set(hostname, resolution);
  return resolution;
};

export type SafeOutboundUrlOptions = {
  allowedProtocols?: readonly string[];
  allowHostname?: (hostname: string) => boolean;
  maxLength?: number;
  rejectIpLiterals?: boolean;
  dnsTimeoutMs?: number;
  cache?: OutboundHostValidationCache;
};

export const validateSafeOutboundUrl = async (
  input: string | URL,
  options: SafeOutboundUrlOptions = {}
): Promise<{ url: URL; addresses: ValidatedNetworkAddress[] }> => {
  const raw = input instanceof URL ? input.toString() : String(input);
  if (raw.length === 0 || raw.length > (options.maxLength ?? 4_096)) {
    throw new OutboundNetworkSafetyError('URL_LENGTH', 'Outbound URL length is invalid');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundNetworkSafetyError('INVALID_URL', 'Outbound URL is invalid');
  }

  const protocols = options.allowedProtocols ?? ['https:'];
  if (!protocols.includes(url.protocol)) {
    throw new OutboundNetworkSafetyError('UNSAFE_PROTOCOL', 'Outbound URL protocol is not allowed');
  }
  if (url.username || url.password) {
    throw new OutboundNetworkSafetyError('URL_CREDENTIALS', 'Outbound URL credentials are not allowed');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isLocalHostname(hostname)) {
    throw new OutboundNetworkSafetyError('UNSAFE_HOST', 'Outbound URL hostname is not allowed');
  }
  if (options.rejectIpLiterals !== false && net.isIP(hostname) !== 0) {
    throw new OutboundNetworkSafetyError('IP_LITERAL', 'IP-literal outbound URLs are not allowed');
  }
  if (options.allowHostname && !options.allowHostname(hostname)) {
    throw new OutboundNetworkSafetyError('HOST_NOT_ALLOWED', 'Outbound URL hostname is not allow-listed');
  }

  const addresses = await resolvePublicHostname(hostname, {
    timeoutMs: options.dnsTimeoutMs,
    cache: options.cache
  });
  return { url, addresses };
};

/**
 * Builds a DNS lookup callback that can only return the addresses validated
 * immediately before the request. Supplying it to an HTTPS agent closes the
 * validation/connect DNS-rebinding gap.
 */
export const createPinnedLookup = (
  rawHostname: string,
  addresses: readonly ValidatedNetworkAddress[]
): LookupFunction => {
  const hostname = normalizeHostname(rawHostname);
  const pinned = addresses.map((entry) => ({ ...entry }));

  return (requestedHostname, lookupOptions, callback) => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      const error = Object.assign(new Error('Pinned lookup hostname mismatch'), { code: 'EACCES' });
      callback(error, '');
      return;
    }

    const options = typeof lookupOptions === 'number'
      ? { family: lookupOptions }
      : lookupOptions;
    const requestedFamily = Number(options?.family || 0);
    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? pinned.filter((entry) => entry.family === requestedFamily)
      : pinned;
    if (candidates.length === 0) {
      const error = Object.assign(new Error('No validated address for requested family'), { code: 'ENOTFOUND' });
      callback(error, '');
      return;
    }

    if (options?.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
};
