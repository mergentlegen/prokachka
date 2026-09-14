type TouchPoint = { x: number; y: number; time: number };

export function isMenuSwipe(start: TouchPoint, end: TouchPoint) {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);
  const duration = end.time - start.time;
  return start.x >= 0 && start.x <= 28 && dx >= 64 && dy <= 36 && dx > dy * 2 && duration > 0 && duration <= 650;
}
