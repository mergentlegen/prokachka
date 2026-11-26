// The math of the photo viewer: zoom (pinch, double tap, wheel), moving a zoomed photo, and what a finished swipe means.
// Points and offsets are in pixels from the centre of the frame the photo is fitted into.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type PhotoView = { scale: number; offset: Point };

export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
export const FITTED: PhotoView = { scale: 1, offset: { x: 0, y: 0 } };

/** The photo on the screen at zoom 1: fitted into the frame and keeping its shape (like object-fit: contain). */
export function fittedSize(frame: Size, photo: Size): Size {
  if (frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 };
  if (photo.width <= 0 || photo.height <= 0) return frame;
  const fit = Math.min(frame.width / photo.width, frame.height / photo.height);
  return { width: photo.width * fit, height: photo.height * fit };
}

/** A zoomed photo moves only as far as its edges reach the frame: no empty space appears beside it. */
export function clampView(view: PhotoView, frame: Size, photo: Size): PhotoView {
  const scale = Math.min(Math.max(view.scale, 1), MAX_ZOOM);
  const shown = fittedSize(frame, photo);
  const limitX = Math.max(0, (shown.width * scale - frame.width) / 2);
  const limitY = Math.max(0, (shown.height * scale - frame.height) / 2);
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit) || 0;
  return { scale, offset: { x: clamp(view.offset.x, limitX), y: clamp(view.offset.y, limitY) } };
}

/** Zoom to `scale` keeping the spot under `point` (a finger, the middle of two fingers, the mouse) where it is. */
export function zoomAt(view: PhotoView, scale: number, point: Point, frame: Size, photo: Size): PhotoView {
  const next = Math.min(Math.max(scale, 1), MAX_ZOOM);
  const factor = next / view.scale;
  return clampView({ scale: next, offset: { x: point.x - (point.x - view.offset.x) * factor, y: point.y - (point.y - view.offset.y) * factor } }, frame, photo);
}

/** Double tap: a fitted photo zooms in at the tapped spot, a zoomed one goes back to fitted. */
export function doubleTapView(view: PhotoView, point: Point, frame: Size, photo: Size): PhotoView {
  return view.scale > 1.01 ? FITTED : zoomAt(view, DOUBLE_TAP_ZOOM, point, frame, photo);
}

/** Pinch: the zoom follows the distance between the fingers, and the spot between them stays under them. */
export function pinchView(start: PhotoView, startMiddle: Point, startDistance: number, middle: Point, distance: number, frame: Size, photo: Size): PhotoView {
  const scale = Math.min(Math.max(start.scale * (distance / Math.max(startDistance, 1)), 1), MAX_ZOOM);
  const factor = scale / start.scale;
  return clampView({ scale, offset: { x: middle.x - (startMiddle.x - start.offset.x) * factor, y: middle.y - (startMiddle.y - start.offset.y) * factor } }, frame, photo);
}

/** A swipe on a fitted photo: down closes it (a long one, or a short flick: `speed` is px/ms downwards at the end),
 * sideways turns to the next or the previous photo. */
export function swipeResult(dx: number, dy: number, speed: number): "close" | "next" | "previous" | "stay" {
  if (dy > 0 && dy >= Math.abs(dx) && (dy > 110 || (dy > 40 && speed > 0.35))) return "close";
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next" : "previous";
  return "stay";
}

/** The finger's speed downwards (px/ms) over its last moments, from (time, y) samples in order. */
export function endSpeed(samples: readonly { at: number; y: number }[], window = 100) {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const from = samples.find((sample) => last.at - sample.at <= window) ?? last;
  return last.at > from.at ? (last.y - from.y) / (last.at - from.at) : 0;
}

/** How dark the background stays while a photo is pulled down to close: it fades as the photo moves away. */
export function pullFade(dy: number) {
  return 1 - Math.min(Math.max(dy, 0) / 420, 0.65);
}
