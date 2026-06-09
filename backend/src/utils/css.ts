/**
 * CSS 코드를 압축합니다. 주석과 불필요한 공백을 제거하되,
 * data URI가 들어간 url(...)은 먼저 보호해서 이미지 문자열 손상을 막습니다.
 */
export const minifyCss = (css: string): string => {
  let minified = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const urls: string[] = [];
  minified = minified.replace(/url\((['"]?)(data:[\w+\/]+;base64,[\s\S]*?|data:image\/svg\+xml[\s\S]*?)\1\)/gi, (match) => {
    urls.push(match);
    return `___URL_PLACEHOLDER_${urls.length - 1}___`;
  });

  minified = minified
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .trim();

  return minified.replace(/___URL_PLACEHOLDER_(\d+)___/g, (_, index) => {
    const originalUrl = urls[parseInt(index, 10)];
    return originalUrl.replace(/\s+/g, ' ');
  });
};
