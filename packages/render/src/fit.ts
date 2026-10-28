/** Pure fit/scale maths (SPEC §7). */
import type { Level } from '@plumb/core';
import type { Bounds, ViewState } from './types.js';

/** Axis-aligned bounds of the level's walls (including half thickness). */
export function levelBounds(level: Level): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of level.walls) {
    const hx = w.thickness / 2;
    for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p[0] - hx);
      x1 = Math.max(x1, p[0] + hx);
      y0 = Math.min(y0, p[1] - hx);
      y1 = Math.max(y1, p[1] + hx);
    }
  }
  if (x0 > x1 || y0 > y1) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

export const FIT_MARGIN_X_MM = 1100;
export const FIT_MARGIN_Y_MM = 900;
export const FIT_PAD_TOP_PX = 70;
export const FIT_PAD_BOTTOM_PX = 84;

export function fitPadX(W: number): number {
  return Math.min(80, W * 0.08);
}

/** Fit the bounds (with spec margins) into W×H, reserving overlay space. */
export function computeFit(b: Bounds, W: number, H: number): ViewState {
  const padX = fitPadX(W);
  const bw = b.x1 - b.x0 + FIT_MARGIN_X_MM * 2;
  const bh = b.y1 - b.y0 + FIT_MARGIN_Y_MM * 2;
  const s = Math.min((W - padX * 2) / bw, (H - FIT_PAD_TOP_PX - FIT_PAD_BOTTOM_PX) / bh);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return { s, x: cx - W / 2 / s, y: cy - (FIT_PAD_TOP_PX + (H - FIT_PAD_TOP_PX - FIT_PAD_BOTTOM_PX) / 2) / s };
}

export const SCALE_BAR_STEPS = [200, 500, 1000, 2000, 5000] as const;

/** First scale-bar length (mm) that is at least 70 px wide. */
export function scaleBarMm(s: number): number {
  for (const n of SCALE_BAR_STEPS) {
    if (n * s >= 70) return n;
  }
  return SCALE_BAR_STEPS[SCALE_BAR_STEPS.length - 1] as number;
}

/** `1:N` readout with N = round(1 / (s × 0.26458)) (96 dpi CSS px). Display only. */
export function scaleReadout(s: number): string {
  return `1:${Math.max(1, Math.round(1 / (s * 0.26458)))}`;
}

export const ZOOM_MIN = 0.015;
export const ZOOM_MAX = 0.6;

/** Zoom about a screen point: the world point under it stays put. */
export function zoomedView(view: ViewState, px: number, py: number, k: number): ViewState {
  const wx = px / view.s + view.x;
  const wy = py / view.s + view.y;
  const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.s * k));
  return { s, x: wx - px / s, y: wy - py / s };
}
