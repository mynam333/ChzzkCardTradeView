/**
 * cryptoService.ts - 민감 정보(치지직 OAuth 토큰) 양방향 암호화 유틸
 *
 * AES-256-GCM을 사용하여 access_token / refresh_token을 DB에 평문으로
 * 저장하지 않도록 합니다. 저장 포맷: "v1:<iv>:<authTag>:<ciphertext>" (각 base64).
 *
 * 기존에 평문으로 저장되어 있던 값과의 하위 호환을 위해, 복호화 시 포맷이
 * 일치하지 않으면 입력값을 그대로 반환합니다(레거시 평문 통과).
 */
import crypto from 'crypto';
import { TOKEN_ENCRYPTION_SECRET } from '../config';

const ALGORITHM = 'aes-256-gcm';
const VERSION_TAG = 'v1';

// 임의 길이의 시크릿 문자열로부터 32바이트 대칭키를 결정적으로 파생
const KEY = crypto.createHash('sha256').update(TOKEN_ENCRYPTION_SECRET).digest();

/**
 * 평문 문자열을 암호화합니다. null/undefined는 그대로 반환합니다.
 */
export const encryptToken = (plain: string | null | undefined): string | null => {
  if (plain === null || plain === undefined || plain === '') {
    return (plain ?? null) as string | null;
  }
  const iv = crypto.randomBytes(12); // GCM 권장 IV 길이 96bit
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION_TAG}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

/**
 * 암호문을 복호화합니다. 암호화 포맷이 아니면(레거시 평문) 입력을 그대로 반환합니다.
 */
export const decryptToken = (stored: string | null | undefined): string | null => {
  if (stored === null || stored === undefined || stored === '') {
    return (stored ?? null) as string | null;
  }

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION_TAG) {
    // 암호화되지 않은 레거시 값으로 간주하고 그대로 반환
    return stored;
  }

  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // 복호화 실패 시(키 변경 등) null 반환하여 잘못된 토큰 사용을 방지
    console.warn('[CryptoService] 토큰 복호화에 실패했습니다. 키가 변경되었을 수 있습니다.');
    return null;
  }
};
