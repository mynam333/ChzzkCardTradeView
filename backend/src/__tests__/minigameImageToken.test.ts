import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMinigameImageReference,
  MINIGAME_IMAGE_REFERENCE_PREFIX,
  MinigameImageTokenError,
  openMinigameImageReference,
  openMinigameImageToken
} from '../services/minigameImageToken';

const issuedAt = new Date('2026-08-02T01:00:00.000Z');

const issueQuizReference = () => createMinigameImageReference({
  userId: 'user-1',
  sessionId: 'session-1',
  round: 2,
  sourceUrl: 'https://api.dicebear.com/9.x/shapes/png?seed=secret-source',
  kind: 'quiz'
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(issuedAt);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('minigame image reference encryption', () => {
  it('round-trips a strictly versioned, user/session/round-bound payload without exposing its source', () => {
    const reference = issueQuizReference();

    expect(reference.startsWith(MINIGAME_IMAGE_REFERENCE_PREFIX)).toBe(true);
    expect(reference).not.toContain('dicebear');
    expect(openMinigameImageReference(reference)).toMatchObject({
      version: 1,
      userId: 'user-1',
      sessionId: 'session-1',
      round: 2,
      sourceUrl: 'https://api.dicebear.com/9.x/shapes/png?seed=secret-source',
      kind: 'quiz'
    });
  });

  it('uses one fixed reference length for short, maximum, UTF-8, quiz, and crop payloads', () => {
    const maxSourcePrefix = 'https://api.dicebear.com/';
    const maxSourceUrl = `${maxSourcePrefix}${'a'.repeat(4_096 - maxSourcePrefix.length)}`;
    const cases = [
      {
        userId: 'u',
        sessionId: 's',
        round: 0,
        sourceUrl: '/uploads/a.png',
        kind: 'quiz' as const
      },
      {
        userId: '한글-사용자',
        sessionId: '세션-식별자',
        round: 1,
        sourceUrl: 'https://api.dicebear.com/카드/초상화.png?이름=가나다',
        kind: 'quiz' as const
      },
      {
        userId: '한'.repeat(191),
        sessionId: '세'.repeat(128),
        round: 31,
        sourceUrl: maxSourceUrl,
        kind: 'crop' as const,
        crop: { x: 0.5, y: 0.5, size: 0.04, rotation: 359 }
      }
    ];

    const references = cases.map((input) => createMinigameImageReference(input));
    expect(new Set(references.map((reference) => reference.length)).size).toBe(1);
    expect(references[0].length).toBeLessThan(8_192);
    const opaque = references[0].slice(MINIGAME_IMAGE_REFERENCE_PREFIX.length);
    expect(Buffer.byteLength(`/api/image-proxy/minigame?mg=${opaque}`, 'utf8')).toBeLessThan(8_192);
    expect(openMinigameImageReference(references[1])).toMatchObject({
      userId: '한글-사용자',
      sessionId: '세션-식별자',
      sourceUrl: 'https://api.dicebear.com/카드/초상화.png?이름=가나다',
      kind: 'quiz'
    });
    expect(openMinigameImageReference(references[2])).toMatchObject({
      userId: '한'.repeat(191),
      sessionId: '세'.repeat(128),
      sourceUrl: maxSourceUrl,
      kind: 'crop',
      crop: { x: 0.5, y: 0.5, size: 0.04, rotation: 359 }
    });
  });

  it('rejects a tampered authenticated ciphertext', () => {
    const opaque = issueQuizReference().slice(MINIGAME_IMAGE_REFERENCE_PREFIX.length);
    const index = Math.floor(opaque.length / 2);
    const replacement = opaque[index] === 'A' ? 'B' : 'A';
    const tampered = `${opaque.slice(0, index)}${replacement}${opaque.slice(index + 1)}`;

    expect(() => openMinigameImageToken(tampered)).toThrowError(MinigameImageTokenError);
  });

  it('rejects expired references after the 30-second validity window', () => {
    const opaque = issueQuizReference().slice(MINIGAME_IMAGE_REFERENCE_PREFIX.length);
    vi.setSystemTime(new Date(issuedAt.getTime() + 30_001));

    try {
      openMinigameImageToken(opaque);
      throw new Error('expected token to expire');
    } catch (error) {
      expect(error).toBeInstanceOf(MinigameImageTokenError);
      expect((error as MinigameImageTokenError).code).toBe('EXPIRED');
      expect((error as MinigameImageTokenError).statusCode).toBe(410);
    }
  });

  it('never accepts legacy plaintext or an unmarked reference', () => {
    const plaintext = Buffer.from(JSON.stringify({
      sourceUrl: 'https://api.dicebear.com/plaintext.png',
      kind: 'quiz'
    })).toString('base64url');

    expect(() => openMinigameImageToken(plaintext)).toThrowError(MinigameImageTokenError);
    expect(() => openMinigameImageReference('https://api.dicebear.com/plaintext.png'))
      .toThrowError(MinigameImageTokenError);
  });

  it('requires a complete crop schema at issue time', () => {
    expect(() => createMinigameImageReference({
      userId: 'user-1',
      sessionId: 'session-1',
      round: 0,
      sourceUrl: '/uploads/card.png',
      kind: 'crop'
    })).toThrowError(MinigameImageTokenError);
  });
});
