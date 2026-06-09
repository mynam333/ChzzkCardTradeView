import { describe, expect, it } from 'vitest';
import { minifyCss } from '../utils/css';

describe('minifyCss', () => {
  it('주석과 불필요한 공백을 제거한다', () => {
    expect(minifyCss(`
      /* 설명 주석 */
      .title {
        color : #fff ;
        box-shadow : 0 0 12px rgba(250, 204, 21, .5) ;
      }
    `)).toBe('.title{color:#fff;box-shadow:0 0 12px rgba(250,204,21,.5);}');
  });

  it('data URI url은 압축 중에도 보존한다', () => {
    const css = '.title { background-image: url("data:image/svg+xml,<svg viewBox=\'0 0 10 10\'></svg>"); color: white; }';
    const minified = minifyCss(css);

    expect(minified).toContain('url("data:image/svg+xml,<svg viewBox=\'0 0 10 10\'></svg>")');
    expect(minified).toContain('color:white');
  });
});
