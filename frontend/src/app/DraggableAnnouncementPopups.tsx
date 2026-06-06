'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, GripHorizontal, Megaphone, Pin, X } from 'lucide-react';
import type { Announcement } from '@/lib/types';
import { getAnnouncementPreview } from '@/lib/announcement';

const POPUP_MARGIN = 12;
const POPUP_GAP = 12;
const POPUP_MAX_WIDTH = 448;
const POPUP_HEIGHT = 248;
const DESKTOP_BREAKPOINT = 768;
const DESKTOP_SIDEBAR_WIDTH = 256;
const MOBILE_HEADER_OFFSET = 64;

type Position = { x: number; y: number };

interface Layout {
  positions: Record<number, Position>;
  visibleCount: number;
  panelWidth: number;
}

interface DraggableAnnouncementPopupsProps {
  popups: Announcement[];
  onDismiss: (id: number, permanently: boolean) => void;
  onOpenDetail: (notice: Announcement) => void;
}

const getContentViewport = () => {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
  const left = viewportLeft + (isDesktop ? DESKTOP_SIDEBAR_WIDTH : 0);
  const top = viewportTop + (isDesktop ? 0 : MOBILE_HEADER_OFFSET);

  return {
    left,
    top,
    width: Math.max(0, viewportLeft + viewportWidth - left),
    height: Math.max(0, viewportTop + viewportHeight - top),
  };
};

const createPopupLayout = (popups: Announcement[]): Layout => {
  const viewport = getContentViewport();
  const panelWidth = Math.min(POPUP_MAX_WIDTH, viewport.width - POPUP_MARGIN * 2);
  const startX = viewport.left + POPUP_MARGIN;
  const startY = viewport.top + POPUP_MARGIN;
  const availableHeight = viewport.height - POPUP_MARGIN * 2;
  const rows = Math.max(1, Math.floor((availableHeight + POPUP_GAP) / (POPUP_HEIGHT + POPUP_GAP)));
  const columns = Math.max(
    1,
    Math.floor((viewport.width - POPUP_MARGIN * 2 + POPUP_GAP) / (panelWidth + POPUP_GAP)),
  );
  const visibleCount = Math.min(popups.length, rows * columns);
  const positions: Record<number, Position> = {};

  popups.slice(0, visibleCount).forEach((popup, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    positions[popup.id] = {
      x: startX + column * (panelWidth + POPUP_GAP),
      y: startY + row * (POPUP_HEIGHT + POPUP_GAP),
    };
  });

  return { positions, visibleCount, panelWidth };
};

export const DraggableAnnouncementPopups: React.FC<DraggableAnnouncementPopupsProps> = ({
  popups,
  onDismiss,
  onOpenDetail,
}) => {
  const [layout, setLayout] = useState<Layout>(() => createPopupLayout(popups));
  const [positions, setPositions] = useState<Record<number, Position>>(() => layout.positions);
  const [focusedPopupId, setFocusedPopupId] = useState<number | null>(popups[0]?.id ?? null);
  const dragRef = useRef<{
    popupId: number;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const visiblePopups = useMemo(
    () => popups.slice(0, layout.visibleCount),
    [layout.visibleCount, popups],
  );

  useEffect(() => {
    const arrangePopups = () => {
      const nextLayout = createPopupLayout(popups);
      setLayout(nextLayout);
      setPositions(nextLayout.positions);
    };

    arrangePopups();
    window.addEventListener('resize', arrangePopups);
    window.visualViewport?.addEventListener('resize', arrangePopups);
    window.visualViewport?.addEventListener('scroll', arrangePopups);

    return () => {
      window.removeEventListener('resize', arrangePopups);
      window.visualViewport?.removeEventListener('resize', arrangePopups);
      window.visualViewport?.removeEventListener('scroll', arrangePopups);
    };
  }, [popups]);

  const clampPosition = (position: Position): Position => {
    const viewport = getContentViewport();
    return {
      x: Math.min(
        Math.max(position.x, viewport.left + POPUP_MARGIN),
        Math.max(viewport.left + POPUP_MARGIN, viewport.left + viewport.width - layout.panelWidth - POPUP_MARGIN),
      ),
      y: Math.min(
        Math.max(position.y, viewport.top + POPUP_MARGIN),
        Math.max(viewport.top + POPUP_MARGIN, viewport.top + viewport.height - POPUP_HEIGHT - POPUP_MARGIN),
      ),
    };
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    popupId: number,
  ) => {
    if (event.button !== 0) return;
    const position = positions[popupId];
    if (!position) return;

    dragRef.current = {
      popupId,
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextPosition = clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    });
    setPositions((current) => ({ ...current, [drag.popupId]: nextPosition }));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (visiblePopups.length === 0) return null;

  return (
    <>
      {visiblePopups.map((popup) => {
        const position = positions[popup.id] ?? layout.positions[popup.id];
        if (!position) return null;

        return (
          <div
            key={popup.id}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`announcement-layer-title-${popup.id}`}
            onPointerDownCapture={() => setFocusedPopupId(popup.id)}
            style={{
              width: `${layout.panelWidth}px`,
              height: `${POPUP_HEIGHT}px`,
              transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
              zIndex: focusedPopupId === popup.id ? 81 : 80,
            }}
            className={`fixed left-0 top-0 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/20 animate-in fade-in zoom-in-95 duration-200 ${focusedPopupId === popup.id ? 'border-primary/40 ring-2 ring-primary/15' : 'border-primary/20 ring-1 ring-white/5'}`}
          >
            <div
              onPointerDown={(event) => handlePointerDown(event, popup.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              className="flex touch-none select-none items-center justify-between border-b border-border/70 bg-gradient-to-r from-primary/15 via-sky-500/10 to-transparent px-4 py-3 cursor-grab active:cursor-grabbing"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Megaphone className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Notice</span>
                    {popup.is_pinned && <Pin className="h-3 w-3 fill-current text-sky-500" />}
                  </div>
                  <h3 id={`announcement-layer-title-${popup.id}`} className="truncate text-sm font-bold text-foreground">
                    공지사항
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <GripHorizontal className="h-4 w-4" aria-hidden="true" />
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onDismiss(popup.id, false)}
                  className="rounded-lg p-1.5 transition hover:bg-secondary hover:text-foreground"
                  aria-label={`${popup.title} 공지 닫기`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
              <button type="button" onClick={() => onOpenDetail(popup)} className="block w-full text-left">
                <h4 className="truncate text-lg font-black tracking-tight text-foreground transition hover:text-primary">
                  {popup.title}
                </h4>
                <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {getAnnouncementPreview(popup.content, 180)}
                </p>
              </button>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-secondary/20 px-5 py-3">
              <button
                onClick={() => onDismiss(popup.id, true)}
                className="whitespace-nowrap text-xs font-medium text-muted-foreground transition hover:text-foreground hover:underline"
              >
                다시 보지 않기
              </button>
              <button
                onClick={() => onOpenDetail(popup)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-md shadow-primary/10 transition hover:bg-primary/90"
              >
                자세히 보기 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
};
