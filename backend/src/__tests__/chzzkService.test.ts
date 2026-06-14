import { describe, expect, it } from 'vitest';
import { isPlaceholderProfileImageUrl } from '../services/chzzkService';

describe('chzzkService profile image validation', () => {
  it('기본 아이콘과 대체 이미지는 프로필 미설정으로 처리한다', () => {
    expect(isPlaceholderProfileImageUrl(null)).toBe(true);
    expect(isPlaceholderProfileImageUrl('')).toBe(true);
    expect(isPlaceholderProfileImageUrl('/icon.png')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://chikapo.yuaru.com/icon.png')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://ssl.pstatic.net/static/nng/glive/icon.png?type=f120')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://api.dicebear.com/10.x/fun-emoji/svg?seed=test')).toBe(true);
  });

  it('실제 외부 프로필 이미지 URL은 허용한다', () => {
    expect(isPlaceholderProfileImageUrl('https://example-cdn.invalid/chzzk/profile_123.webp')).toBe(false);
  });
});
