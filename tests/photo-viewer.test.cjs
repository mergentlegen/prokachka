// The photo viewer of announcements and reviews: zoom like the phone's gallery, swipe down to close, «Сохранить».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');

const zoom = load('frontend/features/announcements/photo-zoom.ts');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const frame = { width: 400, height: 600 };
const wide = { width: 1600, height: 1200 }; // fitted: 400 × 300

test('a photo is fitted into the frame and keeps its shape', () => {
  assert.deepEqual(zoom.fittedSize(frame, wide), { width: 400, height: 300 });
  assert.deepEqual(zoom.fittedSize(frame, { width: 600, height: 1800 }), { width: 200, height: 600 });
  assert.deepEqual(zoom.fittedSize({ width: 0, height: 0 }, wide), { width: 0, height: 0 });
});

test('a zoomed photo moves only as far as its edges; zoom stays between 1 and 4', () => {
  assert.deepEqual(zoom.clampView({ scale: 2, offset: { x: 999, y: 999 } }, frame, wide), { scale: 2, offset: { x: 200, y: 0 } });
  assert.deepEqual(zoom.clampView({ scale: 3, offset: { x: -999, y: -999 } }, frame, wide), { scale: 3, offset: { x: -400, y: -150 } });
  assert.equal(zoom.clampView({ scale: 9, offset: { x: 0, y: 0 } }, frame, wide).scale, zoom.MAX_ZOOM);
  assert.deepEqual(zoom.clampView({ scale: 0.3, offset: { x: 50, y: 50 } }, frame, wide), zoom.FITTED);
});

test('double tap zooms in at the tapped spot and back out; pinch keeps the spot between the fingers', () => {
  const zoomed = zoom.doubleTapView(zoom.FITTED, { x: 100, y: 0 }, frame, wide);
  assert.equal(zoomed.scale, zoom.DOUBLE_TAP_ZOOM);
  assert.deepEqual(zoomed.offset, { x: -150, y: 0 }, 'the tapped spot stays under the finger');
  assert.deepEqual(zoom.doubleTapView(zoomed, { x: 0, y: 0 }, frame, wide), zoom.FITTED);
  const pinched = zoom.pinchView(zoom.FITTED, { x: 50, y: 20 }, 100, { x: 50, y: 20 }, 200, frame, wide);
  assert.deepEqual(pinched, { scale: 2, offset: { x: -50, y: 0 } }, 'it cannot move up or down: at zoom 2 the photo is exactly as tall as the frame');
  assert.equal(zoom.pinchView(zoom.FITTED, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 40, frame, wide).scale, 1, 'pinching in stops at the fitted photo');
});

test('a swipe down closes, a quick short one too; sideways turns the photo; small moves do nothing', () => {
  assert.equal(zoom.swipeResult(10, 140, 0), 'close', 'a long pull, even a slow one');
  assert.equal(zoom.swipeResult(0, 60, 0.9), 'close', 'a quick flick down');
  assert.equal(zoom.swipeResult(0, 60, 0.1), 'stay', 'a slow short pull springs back');
  assert.equal(zoom.swipeResult(0, -200, -2), 'stay', 'up does not close');
  assert.equal(zoom.swipeResult(-120, 20, 0), 'next');
  assert.equal(zoom.swipeResult(120, -30, 0), 'previous');
  assert.equal(zoom.swipeResult(30, 20, 0), 'stay');
  // The speed is the finger's at the end: a pull that stopped before letting go is slow, whatever it was before.
  assert.equal(zoom.endSpeed([{ at: 0, y: 0 }, { at: 50, y: 50 }, { at: 100, y: 100 }]), 1);
  assert.equal(zoom.endSpeed([{ at: 0, y: 0 }, { at: 50, y: 60 }, { at: 400, y: 60 }, { at: 450, y: 61 }]), 0.02);
  assert.equal(zoom.endSpeed([]), 0);
  assert.equal(zoom.pullFade(0), 1);
  assert.ok(zoom.pullFade(200) < 1 && zoom.pullFade(5000) === 0.35);
});

test('the viewer takes the fingers, saves through the phone menu and is used by announcements and reviews', () => {
  const viewer = read('frontend/features/announcements/PhotoViewer.tsx');
  assert.match(viewer, /navigator\.share\(\{ files: \[file\] \}\)/, 'on a phone «Сохранить» opens the share menu');
  assert.match(viewer, /link\.download = file\.name/, 'on a computer the photo is downloaded');
  assert.match(viewer, /aria-label="Сохранить фотографию"/);
  assert.match(viewer, /aria-label="Закрыть фотографию"/);
  assert.match(viewer, /if \(result === "close"\) onClose\(\);/);
  assert.match(viewer, /data-no-pull/, 'pulling the photo down does not reload the page');
  assert.match(read('frontend/features/announcements/AnnouncementGallery.module.css'), /\.stage \{[^}]*touch-action:none/);
  assert.match(read('frontend/features/announcements/AnnouncementGallery.tsx'), /<PhotoViewer photos=\{photos\}/);
  assert.match(read('frontend/features/reviews/ReviewsPanel.tsx'), /<AnnouncementGallery photos=\{review\.photos\}/);
});
