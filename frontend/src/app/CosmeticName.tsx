'use client';

import React, { useEffect } from 'react';
import {
  ensureCosmeticCss,
  ensureFont,
  nameEffectClass,
  nameEffectFontStyle,
  nameEffectStyle
} from '@/lib/cosmetics';
import { KS_2350_HANGUL } from '@/lib/korean';

interface EffectLike { style_json?: string | null; font_url?: string | null; font_family?: string | null }

// KS 완성형 2,350자 판별 Set
const ksSet = new Set(KS_2350_HANGUL);

// 특정 글자가 한글 음절(U+AC00 - U+D7A3)인지 판별
const isHangulSyllable = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
};

// 텍스트를 완성형 여부에 따라 span 분할 노드 배열로 쪼개는 함수
const splitFallbackText = (text: string): React.ReactNode[] => {
  const result: React.ReactNode[] = [];
  let currentText = '';
  let isCurrentFallback = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    // 한글 음절인데 완성형 2,350자에 포함되지 않는다면 폴백 대상
    const needFallback = isHangulSyllable(char) && !ksSet.has(char);

    if (needFallback !== isCurrentFallback) {
      if (currentText) {
        if (isCurrentFallback) {
          result.push(<span key={i - currentText.length} className="ne-fallback-char">{currentText}</span>);
        } else {
          result.push(currentText);
        }
      }
      currentText = char;
      isCurrentFallback = needFallback;
    } else {
      currentText += char;
    }
  }

  if (currentText) {
    if (isCurrentFallback) {
      result.push(<span key={text.length - currentText.length} className="ne-fallback-char">{currentText}</span>);
    } else {
      result.push(currentText);
    }
  }

  return result;
};

// React Node 트리 구조에서 텍스트 노드를 찾아 순회 적용하는 재귀 헬퍼 함수
const renderWithFallback = (node: React.ReactNode): React.ReactNode => {
  if (typeof node === 'string') {
    return splitFallbackText(node);
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((n, idx) => <React.Fragment key={idx}>{renderWithFallback(n)}</React.Fragment>);
  }
  if (React.isValidElement(node)) {
    const children = (node.props as any).children;
    if (children) {
      return React.cloneElement(node, {}, renderWithFallback(children));
    }
  }
  return node;
};

/**
 * 이름 이펙트가 적용된 텍스트.
 * - style_json 의 class 가 있으면 해당 클래스를 적용하고, {"css":..}가 있으면 문서에 1회 주입합니다.
 * - class 가 없으면 레거시 인라인 스타일(nameEffectStyle)을 적용합니다.
 */
export const CosmeticName: React.FC<{ effect?: EffectLike | null; className?: string; children: React.ReactNode }> = ({ effect, className, children }) => {
  const cls = nameEffectClass(effect);
  useEffect(() => {
    ensureCosmeticCss(effect);
    ensureFont(effect?.font_url, effect?.font_family);
  }, [effect?.style_json, effect?.font_url, effect?.font_family]);

  // parsed style_json 가져오기
  const parsed = (() => {
    try {
      return effect?.style_json ? JSON.parse(effect.style_json) : null;
    } catch {
      return null;
    }
  })();
  const fallbackActive = !!parsed?.fallback_ks_active;

  return (
    <span
      className={`${className || ''}${cls ? ` ${cls}` : ''}`}
      style={cls ? {} : nameEffectStyle(effect)}
    >
      {fallbackActive ? renderWithFallback(children) : children}
    </span>
  );
};
