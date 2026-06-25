'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** 표시할 스트리머 닉네임 (없으면 툴팁 미표시) */
  name?: string | null;
  /** 닉네임 외의 내용을 표시할 때 사용 */
  content?: React.ReactNode;
  children: React.ReactNode;
  /** 래퍼 div 클래스 (호버 영역 = children 영역) */
  className?: string;
  /** 텍스트 내부에 넣을 때는 span 래퍼를 사용 */
  as?: 'div' | 'span';
  /** 툴팁 자체에 추가할 클래스 */
  tooltipClassName?: string;
  /** 긴 툴팁이 화면 밖으로 나가지 않도록 보정할 기준값 */
  edgeGuard?: { right?: number; bottom?: number };
}

/**
 * 마우스를 따라다니는 커스텀 툴팁.
 * 보유 카드 썸네일 위에 올리면 스트리머 닉네임을 커서 옆에 표시합니다.
 * 시각 스타일은 globals.css의 .streamer-tooltip (라이트/다크 테마 변수 기반).
 */
export const StreamerTooltip: React.FC<Props> = ({ name, content, children, className, tooltipClassName, edgeGuard, as = 'div' }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const update = (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
  const hide = () => setPos(null);

  // 화면 가장자리에서 잘리지 않도록 커서 기준 위치 보정
  let transform = 'translate(14px, 16px)';
  if (pos && typeof window !== 'undefined') {
    const nearRight = pos.x > window.innerWidth - (edgeGuard?.right ?? 440);
    const nearBottom = pos.y > window.innerHeight - (edgeGuard?.bottom ?? 180);
    const tx = nearRight ? 'calc(-100% - 14px)' : '14px';
    const ty = nearBottom ? 'calc(-100% - 14px)' : '16px';
    transform = `translate(${tx}, ${ty})`;
  }

  const Wrapper = as;
  const tooltipContent = content ?? name;

  return (
    <Wrapper className={className} onMouseEnter={update} onMouseMove={update} onMouseLeave={hide}>
      {children}
      {tooltipContent && pos && typeof document !== 'undefined' && createPortal(
        <div className={`streamer-tooltip ${tooltipClassName ?? ''}`.trim()} style={{ left: pos.x, top: pos.y, transform }} role="tooltip">
          {tooltipContent}
        </div>,
        document.body
      )}
    </Wrapper>
  );
};
