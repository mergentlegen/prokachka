type TouchPoint = { x: number; y: number; time: number };

export function isMenuSwipe(start: TouchPoint, end: TouchPoint) {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);
  const duration = end.time - start.time;
  return start.x >= 0 && start.x <= 28 && dx >= 64 && dy <= 36 && dx > dy * 2 && duration > 0 && duration <= 650;
}

// Safari starts history navigation before touchend. Reserve only the 28px
// non-interactive left edge, using explicitly non-passive native listeners.
export function bindMenuSwipe(element: HTMLElement, onOpen: () => void, enabled: () => boolean) {
  let start: TouchPoint | null = null;
  const reset = () => { start = null; };
  function touchStart(event: TouchEvent) {
    reset();
    const touch = event.touches[0];
    const target = event.target as Element | null;
    if (!enabled() || event.touches.length !== 1 || !touch || touch.clientX < 0 || touch.clientX > 28 ||
      target?.closest?.("input, textarea, select, button, a, summary, [role='slider'], [contenteditable='true'], [role='dialog'], dialog, .modal-backdrop")) return;
    if (!event.cancelable) return;
    event.preventDefault();
    start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
  }
  function touchMove(event: TouchEvent) {
    if (!start) return;
    if (event.touches.length !== 1) { reset(); return; }
    if (event.cancelable) event.preventDefault();
  }
  function touchEnd(event: TouchEvent) {
    const origin = start;
    reset();
    const touch = event.changedTouches[0];
    if (!origin || !touch || event.touches.length || !enabled()) return;
    if (event.cancelable) event.preventDefault();
    if (isMenuSwipe(origin, { x: touch.clientX, y: touch.clientY, time: event.timeStamp })) onOpen();
  }
  element.addEventListener("touchstart", touchStart, { passive: false, capture: true });
  element.addEventListener("touchmove", touchMove, { passive: false, capture: true });
  element.addEventListener("touchend", touchEnd, { passive: false, capture: true });
  element.addEventListener("touchcancel", reset, { capture: true });
  return () => {
    element.removeEventListener("touchstart", touchStart, true);
    element.removeEventListener("touchmove", touchMove, true);
    element.removeEventListener("touchend", touchEnd, true);
    element.removeEventListener("touchcancel", reset, true);
    reset();
  };
}
