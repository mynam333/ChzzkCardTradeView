'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** 표시할 스트리머 닉네임 (없으면 툴팁 미표시) */
  name?: string | null;
  children: React.ReactNode;
  /** 래퍼 div 클래스 (호버 영역 = children 영역) */
  className?: string;
}

/**
 * 마우스를 따라다니는 커스텀 툴팁.
 * 보유 카드 썸네일 위에 올리면 스트리머 닉네임을 커서 옆에 표시합니다.
 * 시각 스타일은 globals.css의 .streamer-tooltip (라이트/다크 테마 변수 기반).
 */
export const StreamerTooltip: React.FC<Props> = ({ name, children, className }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const update = (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
  const hide = () => setPos(null);

  // 화면 가장자리에서 잘리지 않도록 커서 기준 위치 보정
  let transform = 'translate(14px, 16px)';
  if (pos && typeof window !== 'undefined') {
    const nearRight = pos.x > window.innerWidth - 180;
    const nearBottom = pos.y > window.innerHeight - 48;
    const tx = nearRight ? 'calc(-100% - 14px)' : '14px';
    const ty = nearBottom ? 'calc(-100% - 14px)' : '16px';
    transform = `translate(${tx}, ${ty})`;
  }

  return (
    <div className={className} onMouseEnter={update} onMouseMove={update} onMouseLeave={hide}>
      {children}
      {name && pos && typeof document !== 'undefined' && createPortal(
        <div className="streamer-tooltip" style={{ left: pos.x, top: pos.y, transform }} role="tooltip">
          {name}
        </div>,
        document.body
      )}
    </div>
  );
};
