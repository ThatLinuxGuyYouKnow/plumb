/**
 * View gestures on the canvas host element (SPEC §8): wheel zoom about the
 * cursor, single-pointer pan, two-pointer pinch zoom. Hot paths mutate the
 * store through `setView` only; no React, no per-move re-render.
 */
import { zoomedView, ZOOM_MAX, ZOOM_MIN } from './fit.js';
import type { PlumbStore } from './types.js';

type Cv = HTMLCanvasElement;

interface Pointer {
  x: number;
  y: number;
}

export interface GestureOptions {
  /** Which single pointers pan (default: primary or middle drag). */
  isPanPointer?: (e: PointerEvent) => boolean;
}

export function attachViewGestures(canvas: Cv, store: PlumbStore, opts: GestureOptions = {}): () => void {
  const isPanPointer = opts.isPanPointer ?? ((e: PointerEvent): boolean => e.button === 0 || e.button === 1);
  const pointers = new Map<number, Pointer>();
  let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
  let pinch: { dist: number; midX: number; midY: number; s: number; wx: number; wy: number } | null = null;

  const loc = (e: PointerEvent): Pointer => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const view = store.getState().view;
    store.setView(zoomedView(view, e.clientX - r.left, e.clientY - r.top, factor));
  };

  const onPointerDown = (e: PointerEvent): void => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    pointers.set(e.pointerId, loc(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const view = store.getState().view;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      pinch = {
        dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        midX,
        midY,
        s: view.s,
        wx: midX / view.s + view.x,
        wy: midY / view.s + view.y,
      };
      pan = null;
    } else if (pointers.size === 1 && isPanPointer(e)) {
      const view = store.getState().view;
      const p = loc(e);
      pan = { sx: p.x, sy: p.y, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, loc(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pinch.s * dist) / pinch.dist));
      store.setView({ s, x: pinch.wx - midX / s, y: pinch.wy - midY / s });
    } else if (pan) {
      const p = loc(e);
      const view = store.getState().view;
      store.setView({ ...view, x: pan.vx - (p.x - pan.sx) / view.s, y: pan.vy - (p.y - pan.sy) / view.s });
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) pan = null;
  };

  const onCancel = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinch = null;
    pan = null;
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onCancel);
  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onCancel);
  };
}
