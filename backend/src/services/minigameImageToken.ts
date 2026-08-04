import crypto from 'crypto';
import { TOKEN_ENCRYPTION_SECRET } from '../config';

export const MINIGAME_IMAGE_REFERENCE_PREFIX = 'minigame-image:v1:';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
// Round references can be issued while answer feedback is visible. Keep them
// valid for the same bounded window as a started round-game session so an
// intentional pause before "next question" does not manufacture a 410.
export const MINIGAME_IMAGE_TOKEN_TTL_MS = 3 * 60_000;
const MAX_CLOCK_SKEW_MS = 5_000;
// 5,600 encrypted plaintext bytes produce a 7,504-character base64url token
// (including the IV/tag but excluding the short marker), leaving room beneath
// an 8 KiB request-line limit for `/api/image-proxy/minigame?mg=`.
const FIXED_ENVELOPE_BYTES = 5_600;
const MAX_TOKEN_LENGTH = Math.ceil((FIXED_ENVELOPE_BYTES + IV_BYTES + AUTH_TAG_BYTES) * 4 / 3);
const MAX_SOURCE_URL_LENGTH = 4_096;
const MAX_SOURCE_URL_JSON_BYTES = 4_096;
const MAX_USER_ID_LENGTH = 191;
const MAX_SESSION_ID_LENGTH = 128;
const AAD = Buffer.from('chikapo:minigame-image-reference:v1', 'utf8');
const KEY = crypto
  .createHmac('sha256', TOKEN_ENCRYPTION_SECRET)
  .update('chikapo:minigame-image-reference:aes-256-gcm:v1', 'utf8')
  .digest();

export type MinigameImageKind = 'quiz' | 'crop';

export interface MinigameImageCrop {
  x: number;
  y: number;
  size: number;
  rotation: number;
}

export interface MinigameImagePayload {
  version: 1;
  userId: string;
  sessionId: string;
  round: number;
  sourceUrl: string;
  kind: MinigameImageKind;
  crop?: MinigameImageCrop;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
}

export type CreateMinigameImageReferenceInput = {
  userId: string;
  sessionId: string;
  round: number;
  sourceUrl: string;
  kind: MinigameImageKind;
  crop?: MinigameImageCrop;
};

export class MinigameImageTokenError extends Error {
  readonly code: 'INVALID' | 'EXPIRED';
  readonly statusCode: 400 | 410;

  constructor(code: 'INVALID' | 'EXPIRED') {
    super(code === 'EXPIRED' ? 'MINIGAME_IMAGE_TOKEN_EXPIRED' : 'MINIGAME_IMAGE_TOKEN_INVALID');
    this.name = 'MinigameImageTokenError';
    this.code = code;
    this.statusCode = code === 'EXPIRED' ? 410 : 400;
  }
}

const invalidToken = (): never => {
  throw new MinigameImageTokenError('INVALID');
};

const assertPlainObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidToken();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidToken();
  return value as Record<string, unknown>;
};

const hasExactKeys = (value: Record<string, unknown>, expected: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const jsonStringContentByteLength = (value: string): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;

const isSafeIdentifier = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= maxLength &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/.test(value) &&
  !hasUnpairedSurrogate(value);

const isSafeSourceUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SOURCE_URL_LENGTH) return false;
  if (
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    hasUnpairedSurrogate(value) ||
    jsonStringContentByteLength(value) > MAX_SOURCE_URL_JSON_BYTES
  ) return false;
  if (value.startsWith('/uploads/') || value.startsWith('uploads/')) return true;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
};

const normalizeCrop = (value: unknown): MinigameImageCrop => {
  const crop = assertPlainObject(value);
  if (!hasExactKeys(crop, ['x', 'y', 'size', 'rotation'])) return invalidToken();
  const { x, y, size, rotation } = crop;
  if (
    typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
    typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1 ||
    typeof size !== 'number' || !Number.isFinite(size) || size < 0.04 || size > 0.5 ||
    typeof rotation !== 'number' || !Number.isInteger(rotation) || rotation < 0 || rotation >= 360
  ) return invalidToken();
  return { x, y, size, rotation };
};

const normalizePayload = (value: unknown, now: number): MinigameImagePayload => {
  const payload = assertPlainObject(value);
  const kind = payload.kind;
  const expectedKeys = kind === 'crop'
    ? ['version', 'userId', 'sessionId', 'round', 'sourceUrl', 'kind', 'crop', 'issuedAt', 'notBefore', 'expiresAt']
    : ['version', 'userId', 'sessionId', 'round', 'sourceUrl', 'kind', 'issuedAt', 'notBefore', 'expiresAt'];
  if (!hasExactKeys(payload, expectedKeys)) return invalidToken();
  if (payload.version !== 1 || (kind !== 'quiz' && kind !== 'crop')) return invalidToken();
  if (
    !isSafeIdentifier(payload.userId, MAX_USER_ID_LENGTH) ||
    !isSafeIdentifier(payload.sessionId, MAX_SESSION_ID_LENGTH) ||
    !isSafeSourceUrl(payload.sourceUrl)
  ) {
    return invalidToken();
  }
  if (typeof payload.round !== 'number' || !Number.isInteger(payload.round) || payload.round < 0 || payload.round > 31) {
    return invalidToken();
  }
  if (
    typeof payload.issuedAt !== 'number' || !Number.isSafeInteger(payload.issuedAt) ||
    typeof payload.notBefore !== 'number' || !Number.isSafeInteger(payload.notBefore) ||
    typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt > now + MAX_CLOCK_SKEW_MS ||
    payload.notBefore < payload.issuedAt ||
    payload.notBefore > now + MAX_CLOCK_SKEW_MS ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > MINIGAME_IMAGE_TOKEN_TTL_MS
  ) return invalidToken();
  if (payload.expiresAt <= now) throw new MinigameImageTokenError('EXPIRED');

  return {
    version: 1,
    userId: payload.userId,
    sessionId: payload.sessionId,
    round: payload.round,
    sourceUrl: payload.sourceUrl,
    kind,
    ...(kind === 'crop' ? { crop: normalizeCrop(payload.crop) } : {}),
    issuedAt: payload.issuedAt,
    notBefore: payload.notBefore,
    expiresAt: payload.expiresAt
  };
};

const decodeBase64UrlStrict = (value: string): Buffer => {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return invalidToken();
  const decoded = Buffer.from(value, 'base64url');
  if (!decoded.length || decoded.toString('base64url') !== value) return invalidToken();
  return decoded;
};

const encodeFixedEnvelope = (payload: unknown): Buffer => {
  let unpadded: string;
  try {
    unpadded = JSON.stringify({ payload, padding: '' });
  } catch {
    return invalidToken();
  }
  const unpaddedBytes = Buffer.byteLength(unpadded, 'utf8');
  const paddingLength = FIXED_ENVELOPE_BYTES - unpaddedBytes;
  if (paddingLength < 1) return invalidToken();

  const plaintext = Buffer.from(JSON.stringify({
    payload,
    padding: 'P'.repeat(paddingLength)
  }), 'utf8');
  if (plaintext.byteLength !== FIXED_ENVELOPE_BYTES) return invalidToken();
  return plaintext;
};

export const createMinigameImageReference = (
  input: CreateMinigameImageReferenceInput
): string => {
  const now = Date.now();
  const payload = normalizePayload({
    version: 1,
    userId: input.userId,
    sessionId: input.sessionId,
    round: input.round,
    sourceUrl: input.sourceUrl,
    kind: input.kind,
    ...(input.kind === 'crop' ? { crop: input.crop } : {}),
    issuedAt: now,
    notBefore: now,
    expiresAt: now + MINIGAME_IMAGE_TOKEN_TTL_MS
  }, now);
  const plaintext = encodeFixedEnvelope(payload);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const opaque = Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
  if (opaque.length !== MAX_TOKEN_LENGTH) return invalidToken();
  return `${MINIGAME_IMAGE_REFERENCE_PREFIX}${opaque}`;
};

/** Opens only the opaque token portion placed in the `mg` query parameter. */
export const openMinigameImageToken = (opaque: string): MinigameImagePayload => {
  if (typeof opaque !== 'string' || opaque.length !== MAX_TOKEN_LENGTH) return invalidToken();
  const packed = decodeBase64UrlStrict(opaque);
  if (packed.length !== FIXED_ENVELOPE_BYTES + IV_BYTES + AUTH_TAG_BYTES) {
    return invalidToken();
  }

  const iv = packed.subarray(0, IV_BYTES);
  const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);
  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return invalidToken();
  }
  if (plaintext.byteLength !== FIXED_ENVELOPE_BYTES) return invalidToken();

  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext.toString('utf8'));
  } catch {
    return invalidToken();
  }
  const envelope = assertPlainObject(decoded);
  if (!hasExactKeys(envelope, ['payload', 'padding'])) return invalidToken();
  if (typeof envelope.padding !== 'string' || !/^P+$/.test(envelope.padding)) return invalidToken();
  const canonicalPlaintext = encodeFixedEnvelope(envelope.payload);
  if (!crypto.timingSafeEqual(plaintext, canonicalPlaintext)) return invalidToken();
  return normalizePayload(envelope.payload, Date.now());
};

export const openMinigameImageReference = (reference: string): MinigameImagePayload => {
  if (typeof reference !== 'string' || !reference.startsWith(MINIGAME_IMAGE_REFERENCE_PREFIX)) {
    return invalidToken();
  }
  return openMinigameImageToken(reference.slice(MINIGAME_IMAGE_REFERENCE_PREFIX.length));
};
