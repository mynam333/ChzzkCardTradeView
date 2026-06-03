/**
 * 마크다운 토큰 타입 정의
 */
export type MarkdownToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'link'; text: string; url: string };

/**
 * 마크다운 라인 타입 정의
 */
export type MarkdownLine =
  | { type: 'empty' }
  | { type: 'bullet'; tokens: MarkdownToken[] }
  | { type: 'normal'; tokens: MarkdownToken[] };

/**
 * 텍스트 라인 한 줄 내의 볼드와 링크 문법을 파싱하여 토큰 배열로 반환합니다.
 */
export function parseLineContent(text: string): MarkdownToken[] {
  // 볼드(**텍스트**)와 링크([텍스트](링크))를 분리하기 위한 정규식
  const regex = /(\*\*.*?\*\*|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);
  const tokens: MarkdownToken[] = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('**') && part.endsWith('**')) {
      tokens.push({ type: 'bold', content: part.slice(2, -2) });
    } else {
      const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch) {
        tokens.push({ type: 'link', text: linkMatch[1], url: linkMatch[2] });
      } else {
        tokens.push({ type: 'text', content: part });
      }
    }
  }

  return tokens;
}

/**
 * 마크다운 본문 전체를 파싱하여 구조화된 라인 배열로 반환합니다.
 */
export function parseMarkdown(content: string): MarkdownLine[] {
  if (!content) return [];

  const lines = content.split('\n');

  return lines.map((line) => {
    const trimmed = line.trim();

    if (trimmed === '') {
      return { type: 'empty' };
    }

    const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('* ');
    if (isBullet) {
      const cleanLine = line.trimStart().substring(2);
      return {
        type: 'bullet',
        tokens: parseLineContent(cleanLine),
      };
    }

    return {
      type: 'normal',
      tokens: parseLineContent(line),
    };
  });
}
