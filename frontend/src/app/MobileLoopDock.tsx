'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type MobileLoopDockItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
};

type MobileLoopDockProps<T extends string> = {
  items: MobileLoopDockItem<T>[];
  activeId: T;
  ariaLabel: string;
  onSelect: (id: T, item: MobileLoopDockItem<T>) => void;
  dataAttribute?: string;
  surfaceShadowClassName?: string;
};

const loopIndex = (index: number, length: number) => ((index % length) + length) % length;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function MobileLoopDock<T extends string>({
  items,
  activeId,
  ariaLabel,
  onSelect,
  dataAttribute,
  surfaceShadowClassName = 'shadow-[0_18px_46px_rgba(20,101,170,0.20)] dark:shadow-[0_18px_46px_rgba(0,0,0,0.34)]'
}: MobileLoopDockProps<T>) {
  const dockTouchStartX = React.useRef<number | null>(null);
  const dockTouchStartY = React.useRef<number | null>(null);
  const dockClickSuppressed = React.useRef(false);
  const dockSnapTimer = React.useRef<number | null>(null);
  const [dockDragDelta, setDockDragDelta] = React.useState(0);
  const [dockPressedId, setDockPressedId] = React.useState<T | null>(null);
  const [dockIsDragging, setDockIsDragging] = React.useState(false);
  const [dockIsSettling, setDockIsSettling] = React.useState(false);
  const [dockVisualId, setDockVisualId] = React.useState<{ id: T; from: T } | null>(null);

  React.useEffect(() => () => {
    if (dockSnapTimer.current !== null) window.clearTimeout(dockSnapTimer.current);
  }, []);

  if (items.length === 0) return null;

  const visualId = dockVisualId?.from === activeId ? dockVisualId.id : activeId;
  const activeNavIndex = Math.max(0, items.findIndex((item) => item.id === visualId));
  const dockSlotWidth = 72;
  const dockRenderedSideSlots = Math.max(8, items.length * 2);
  const dockDragProgress = dockDragDelta / dockSlotWidth;
  const mobileDockItems = Array.from({ length: dockRenderedSideSlots * 2 + 1 }, (_, index) => index - dockRenderedSideSlots).map((offset) => ({
    offset,
    item: items[loopIndex(activeNavIndex + offset, items.length)]
  }));

  const triggerLightHaptic = () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }
  };

  const settleMobileDockToOffset = (offset: number) => {
    const nextItem = items[loopIndex(activeNavIndex + offset, items.length)];
    if (!nextItem || nextItem.id === activeId) return;

    if (dockSnapTimer.current !== null) window.clearTimeout(dockSnapTimer.current);
    dockClickSuppressed.current = true;
    setDockIsDragging(false);
    setDockIsSettling(true);
    setDockDragDelta(-offset * dockSlotWidth);
    triggerLightHaptic();
    window.setTimeout(() => {
      dockClickSuppressed.current = false;
    }, 240);

    dockSnapTimer.current = window.setTimeout(() => {
      setDockVisualId({ id: nextItem.id, from: activeId });
      onSelect(nextItem.id, nextItem);
      setDockDragDelta(0);
      setDockIsSettling(false);
      dockSnapTimer.current = null;
    }, 220);
  };

  const snapMobileDockVisualToOffset = (offset: number) => {
    const nextItem = items[loopIndex(activeNavIndex + offset, items.length)];
    if (!nextItem) return;

    if (dockSnapTimer.current !== null) window.clearTimeout(dockSnapTimer.current);
    dockClickSuppressed.current = true;
    setDockIsDragging(false);
    setDockIsSettling(true);
    setDockDragDelta(-offset * dockSlotWidth);
    triggerLightHaptic();
    window.setTimeout(() => {
      dockClickSuppressed.current = false;
    }, 240);

    dockSnapTimer.current = window.setTimeout(() => {
      setDockVisualId({ id: nextItem.id, from: activeId });
      setDockDragDelta(0);
      setDockIsSettling(false);
      dockSnapTimer.current = null;
    }, 220);
  };

  const handleDockPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (dockSnapTimer.current !== null) {
      window.clearTimeout(dockSnapTimer.current);
      dockSnapTimer.current = null;
    }
    dockTouchStartX.current = event.clientX;
    dockTouchStartY.current = event.clientY;
    setDockIsSettling(false);
    setDockIsDragging(true);
    setDockDragDelta(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleDockPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (dockTouchStartX.current === null || dockTouchStartY.current === null) return;
    const dx = event.clientX - dockTouchStartX.current;
    const dy = event.clientY - dockTouchStartY.current;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;
    setDockDragDelta(dx);
  };

  const finishDockPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (dockTouchStartX.current === null || dockTouchStartY.current === null) return;
    const dx = event.clientX - dockTouchStartX.current;
    const dy = event.clientY - dockTouchStartY.current;
    dockTouchStartX.current = null;
    dockTouchStartY.current = null;
    setDockIsDragging(false);
    setDockPressedId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      const targetOffset = Math.round(-dx / dockSlotWidth);
      if (targetOffset !== 0) {
        snapMobileDockVisualToOffset(targetOffset);
        return;
      }
    }

    setDockIsSettling(true);
    setDockDragDelta(0);
    dockSnapTimer.current = window.setTimeout(() => {
      setDockIsSettling(false);
      dockSnapTimer.current = null;
    }, 180);
  };

  return (
    <nav
      data-easter-nav={dataAttribute}
      className="fixed bottom-2 left-0 right-0 z-50 px-3 md:hidden"
      aria-label={ariaLabel}
      onPointerDown={handleDockPointerDown}
      onPointerMove={handleDockPointerMove}
      onPointerUp={finishDockPointer}
      onPointerCancel={finishDockPointer}
      style={{ touchAction: 'pan-y' }}
    >
      <div
        className="relative mx-auto w-full overflow-visible"
        style={{
          height: 'calc(7.15rem + env(safe-area-inset-bottom))'
        }}
      >
        <div
          className={`cute-surface pointer-events-none absolute inset-x-0 bottom-0 z-0 overflow-hidden border border-white/70 backdrop-blur-xl dark:border-white/10 ${surfaceShadowClassName}`}
          style={{
            height: 'calc(5.15rem + env(safe-area-inset-bottom))',
            borderRadius: '58% 58% 2.35rem 2.35rem / 46% 46% 2.15rem 2.15rem',
            WebkitMaskImage: 'radial-gradient(140% 2.15rem at 50% calc(100% + 1.35rem), transparent 0 54%, #000 56%)',
            maskImage: 'radial-gradient(140% 2.15rem at 50% calc(100% + 1.35rem), transparent 0 54%, #000 56%)'
          }}
        >
          <div className="pointer-events-none absolute inset-x-5 top-1 h-11 rounded-[50%] border-t border-primary/20" />
          <div className="pointer-events-none absolute inset-x-8 bottom-[calc(0.35rem+env(safe-area-inset-bottom))] h-5 rounded-[50%] border-b border-primary/15" />
        </div>
        {mobileDockItems.map(({ item, offset }) => {
          const Icon = item.icon;
          const curvePosition = offset + dockDragProgress;
          const distance = Math.abs(curvePosition);
          const centerWeight = clamp(1 - distance / 0.95, 0, 1);
          const visibleWeight = clamp(1 - Math.max(0, distance - 2.15) / 0.55, 0, 1);
          const x = curvePosition * dockSlotWidth;
          const y = 5 + Math.pow(Math.min(distance, 2.55), 2) * 5.4;
          const iconSize = 40 + centerWeight * 18;
          const iconColorMix = Math.round(centerWeight * 100);
          const iconBgMix = Math.round(18 + centerWeight * 82);
          const isCentered = centerWeight > 0.72;
          const pressScale = dockPressedId === item.id ? 0.94 : 1;

          return (
            <button
              key={`${item.id}-${offset}`}
              type="button"
              onPointerDown={() => setDockPressedId(item.id)}
              onPointerUp={() => setDockPressedId(null)}
              onPointerCancel={() => setDockPressedId(null)}
              onClick={() => {
                if (dockClickSuppressed.current) return;
                if (offset === 0) {
                  triggerLightHaptic();
                  onSelect(item.id, item);
                  return;
                }
                settleMobileDockToOffset(offset);
              }}
              className={`group absolute left-1/2 top-0.5 flex w-16 flex-col items-center gap-1 rounded-[1.45rem] px-1 pb-1 pt-1.5 ${
                dockIsDragging ? '' : dockIsSettling ? 'transition-[transform,opacity] duration-200 ease-out' : 'transition-[transform,opacity] duration-150 ease-out'
              }`}
              style={{
                transform: `translateX(-50%) translateX(${x}px) translateY(${y}px) scale(${pressScale})`,
                opacity: visibleWeight,
                pointerEvents: visibleWeight < 0.15 ? 'none' : 'auto',
                zIndex: Math.round(20 - distance * 4)
              }}
              aria-current={isCentered ? 'page' : undefined}
            >
              <span
                className="relative flex items-center justify-center rounded-full transition-[width,height,background,color,box-shadow,ring-color] duration-200"
                style={{
                  width: `${iconSize}px`,
                  height: `${iconSize}px`,
                  color: centerWeight > 0.02
                    ? `color-mix(in srgb, var(--primary-foreground) ${iconColorMix}%, var(--muted-foreground))`
                    : 'var(--muted-foreground)',
                  background: centerWeight > 0.02
                    ? `color-mix(in srgb, var(--primary) ${iconBgMix}%, var(--secondary))`
                    : 'color-mix(in srgb, var(--secondary) 76%, var(--card))',
                  boxShadow: centerWeight > 0.02
                    ? `0 ${Math.round(8 + centerWeight * 9)}px ${Math.round(18 + centerWeight * 22)}px color-mix(in srgb, var(--primary) ${Math.round(12 + centerWeight * 24)}%, transparent)`
                    : '0 4px 10px rgba(15, 80, 130, 0.08)',
                  outline: centerWeight > 0.45 ? '4px solid color-mix(in srgb, var(--primary) 12%, transparent)' : '0 solid transparent'
                }}
              >
                <Icon
                  className="transition-[width,height] duration-200"
                  style={{
                    width: `${20 + centerWeight * 5}px`,
                    height: `${20 + centerWeight * 5}px`
                  }}
                />
              </span>
              <span
                className="-mx-3 w-[4.75rem] whitespace-nowrap text-center text-[11px] font-black leading-tight transition-[color,opacity] duration-200"
                style={{
                  color: centerWeight > 0.02
                    ? `color-mix(in srgb, var(--foreground) ${Math.round(62 + centerWeight * 38)}%, var(--muted-foreground))`
                    : 'var(--muted-foreground)',
                  opacity: 0.72 + centerWeight * 0.28
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
