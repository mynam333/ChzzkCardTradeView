import { marked } from 'marked';
import { formatLocalDate } from './time';

type MarkdownNode = {
  type?: string;
  text?: string;
  tokens?: MarkdownNode[];
  items?: MarkdownNode[];
  header?: MarkdownNode[][];
  rows?: MarkdownNode[][];
};

const collectMarkdownText = (node: MarkdownNode): string => {
  const nested = [
    ...(node.tokens ?? []),
    ...(node.items ?? []),
    ...(node.header ?? []).flat(),
    ...(node.rows ?? []).flat(),
  ];

  if (nested.length > 0) {
    return nested.map(collectMarkdownText).join(' ');
  }

  return node.text ?? '';
};

export const getAnnouncementPreview = (content: string, maxLength = 120) => {
  const tokens = marked.lexer(content) as unknown as MarkdownNode[];
  const plainText = tokens
    .map(collectMarkdownText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length <= maxLength) return plainText;
  return `${plainText.slice(0, maxLength).trimEnd()}...`;
};

export const formatAnnouncementDate = (value?: string) => {
  return formatLocalDate(value, '작성일 정보 없음');
};
