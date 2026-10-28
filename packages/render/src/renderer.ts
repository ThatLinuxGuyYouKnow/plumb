/**
 * createRenderer: owns the canvas, redraws on store changes (rAF-coalesced),
 * keeps the animation loop alive only while something animates and motion is
 * allowed (SPEC §3).
 */
import { computeFit, levelBounds } from './fit.js';
import { draw } from './draw.js';
import { readTheme, watchTheme, type Theme } from './theme.js';
import type { PlumbStore } from './types.js';

type Cv = HTMLCanvasElement;

export interface Renderer {
  /** Re-read canvas size (also driven by ResizeObserver on the stage). */
  resize(): void;
  /** Fit the plan into the view. */
  fit(): void;
  /** Current `1:N` scale readout text. */
  scaleText(): string;
  destroy(): void;
}

export interface RendererOptions {
  /** Fit automatically on the first resize (default true). */
  autoFit?: boolean;
}

const MAX_DPR = 2.5;

export function createRenderer(canvas: Cv, store: PlumbStore, opts: RendererOptions = {}): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const stage = canvas.parentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theme: Theme = readTheme(document);
  let dpr = 1;
  let raf = 0;
  let alive = true;
  let firstResize = true;

  const cssSize = (): { W: number; H: number } => ({
    W: canvas.clientWidth,
    H: canvas.clientHeight,
  });

  const animating = (): boolean => {
    if (reduce) return false;
    const { agent } = store.getState();
    return (
      (agent.proposal?.status === 'pending') === true ||
      agent.marks.length > 0 ||
      (agent.flash !== null && Date.now() < agent.flash.until)
    );
  };

  const frame = (): void => {
    raf = 0;
    const { W, H } = cssSize();
    if (!W || !H) return;
    draw(store.getState(), { ctx, W, H, T: theme, t: performance.now(), reduce });
    if (animating()) raf = requestAnimationFrame(frame);
  };

  const requestRender = (): void => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const resize = (): void => {
    const r = stage ? stage.getBoundingClientRect() : canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (firstResize && opts.autoFit !== false) {
      firstResize = false;
      fit();
    }
    requestRender();
  };

  function fit(): void {
    const state = store.getState();
    const { W, H } = cssSize();
    if (!W || !H) return;
    store.setView(computeFit(levelBounds(state.level), W, H));
  }

  const unsubStore = store.subscribe(requestRender);
  const stopTheme = watchTheme(document, () => {
    theme = readTheme(document);
    requestRender();
  });
  const ro = new ResizeObserver(resize);
  if (stage) ro.observe(stage);
  else ro.observe(canvas);

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (alive) requestRender();
    });
  }

  resize();

  return {
    resize,
    fit,
    scaleText(): string {
      const s = store.getState().view.s;
      return `1:${Math.max(1, Math.round(1 / (s * 0.26458)))}`;
    },
    destroy(): void {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      unsubStore();
      stopTheme();
      ro.disconnect();
    },
  };
}


