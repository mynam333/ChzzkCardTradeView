import React from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

// marked 옵션 설정
marked.setOptions({
  gfm: true,     // GitHub Flavored Markdown (취소선 ~~ 등 지원)
  breaks: true,   // 줄바꿈을 <br>로 변환
});

/**
 * 공지 및 팝업 본문을 marked 마크다운 파서에 맞추어 렌더링하는 컴포넌트
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // marked.parse()를 사용하여 HTML 변환을 완료합니다. (비동기 콜백 미등록 시 동기 반환됨)
  const htmlContent = marked.parse(content) as string;

  return (
    <div 
      className="markdown-body text-sm leading-relaxed text-muted-foreground space-y-1.5 break-words"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};
