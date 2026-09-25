import type { MouseEvent, PointerEvent } from 'react';

// Pointer users act on contact; keyboard and assistive activation use click.
// Ignore the compatibility click after pointerup to avoid submitting twice.
export const minigamePress = (activate: () => void) => ({
  onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    activate();
  },
  onClick(event: MouseEvent<HTMLElement>) {
    if (event.detail === 0) activate();
  },
});
