import React from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

const escapeAttribute = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const isSafeLink = (href: string) => /^(?:https?:|mailto:|tel:|\/|#)/i.test(href.trim());
const isSafeImage = (href: string) => /^(?:https?:|\/)/i.test(href.trim());

const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeAttribute(text);
renderer.link = ({ href, title, tokens }) => {
  const label = renderer.parser.parseInline(tokens);
  if (!isSafeLink(href)) return label;
  const safeHref = escapeAttribute(href);
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
  const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${safeHref}"${safeTitle}${external}>${label}</a>`;
};
renderer.image = ({ href, title, text }) => {
  if (!isSafeImage(href)) return escapeAttribute(text);
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${safeTitle} loading="lazy">`;
};

marked.setOptions({
  gfm: true,     // GitHub Flavored Markdown (취소선 ~~ 등 지원)
  breaks: true,   // 줄바꿈을 <br>로 변환
  renderer,
});

export const renderSafeMarkdown = (content: string) => marked.parse(content) as string;

/**
 * 공지 및 팝업 본문을 marked 마크다운 파서에 맞추어 렌더링하는 컴포넌트
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // marked.parse()를 사용하여 HTML 변환을 완료합니다. (비동기 콜백 미등록 시 동기 반환됨)
  const htmlContent = renderSafeMarkdown(content);

  return (
    <div 
      className="markdown-body text-sm leading-relaxed text-muted-foreground space-y-1.5 break-words"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};
