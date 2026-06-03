import React from 'react';
import { ExternalLink } from 'lucide-react';
import { parseMarkdown, MarkdownToken } from './markdownParser';

interface MarkdownRendererProps {
  content: string;
}

/**
 * 토큰 배열을 React Node 배열로 렌더링하는 헬퍼 함수
 */
const renderTokens = (tokens: MarkdownToken[]): React.ReactNode[] => {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'bold':
        return (
          <strong key={index} className="font-bold text-foreground">
            {token.content}
          </strong>
        );
      case 'link':
        return (
          <a
            key={index}
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:text-primary/80 hover:underline transition-colors break-all"
          >
            {token.text}
            <ExternalLink className="h-3 w-3 inline shrink-0" />
          </a>
        );
      case 'text':
      default:
        return <span key={index}>{token.content}</span>;
    }
  });
};

/**
 * 공지 및 팝업 본문을 구조화된 마크다운 토큰에 맞추어 렌더링하는 컴포넌트
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  const parsedLines = parseMarkdown(content);

  return (
    <div className="space-y-1 text-left">
      {parsedLines.map((line, index) => {
        switch (line.type) {
          case 'empty':
            return <div key={index} className="h-2" />;
          case 'bullet':
            return (
              <div key={index} className="flex items-start gap-1.5 pl-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="flex-1 text-sm leading-relaxed text-muted-foreground">
                  {renderTokens(line.tokens)}
                </span>
              </div>
            );
          case 'normal':
          default:
            return (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground">
                {renderTokens(line.tokens)}
              </p>
            );
        }
      })}
    </div>
  );
};
