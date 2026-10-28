/** Canvas host: owns the renderer imperatively; all tools mutate the store directly. */
import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import {
  applyOps,
  type Item,
  type Level,
  type Op,
  type Vec,
} from '@plumb/core';
import {
  createRenderer,
  hitTest,
  nearestWall,
  wallCoords,
  zoomedView,
  type Renderer,
  type Selection,
} from '@plumb/render';
import {
  applyOpsToPlan,
  doRedo,
  doUndo,
  getLevel,
  patchUi,
  pushHistoryEntry,
  rendererStore,
  setPlanLevelSilent,
  setView,
  toast,
  useApp,
} from '../store.js';

export const rendererRef: { current: Renderer | null } = { current: null };
export const canvasRef: { current: HTMLCanvasElement | null } = { current: null };

function toWorld(e: PointerEvent | React.PointerEvent, canvas: HTMLCanvasElement): Vec {
  const r = canvas.getBoundingClientRect();
  const view = useApp.getState().view;
  const sx = (e.clientX - r.left);
  const sy = (e.clientY - r.top);
  return [sx / view.s + view.x, sy / view.s + view.y];
}

function snapGrid(v: number, alt: boolean): number {
  const snap = useApp.getState().ui.snap && !alt;
  return snap ? Math.round(v / 100) * 100 : v;
}

function snapDrag(v: number, alt: boolean): number {
  const snap = useApp.getState().ui.snap && !alt;
  return snap ? Math.round(v / 50) * 50 : v;
}

function endSnap(level: Level, p: Vec, viewS: number): Vec {
  let best: Vec | null = null;
  let bestD = 12 / viewS;
  for (const w of level.walls) {
    for (const e of [w.a, w.b]) {
      const d = Math.hypot(e[0] - p[0], e[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  return best ?? p;
}

interface DragState {
  kind: 'none' | 'item' | 'pan' | 'pinch';
  itemId?: string;
  before?: { x: number; y: number };
  moved?: boolean;
  /** Screen-space anchor of a single-pointer item drag (the live pointers map moves). */
  start?: { x: number; y: number };
  panStart?: { sx: number; sy: number; vx: number; vy: number };
  pinch?: { dist: number; s: number; wx: number; wy: number };
  pointers?: Map<number, { x: number; y: number }>;
}

export function CanvasView(): JSX.Element {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState>({ kind: 'none' });
  const wallAnchor = useRef<Vec | null>(null);

  // Create the renderer once.
  useEffect(() => {
    const canvas = canvasEl.current;
    if (!canvas) return;
    canvasRef.current = canvas;
    const store = rendererStore();
    const renderer = createRenderer(canvas, store);
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // Wheel zoom (non-passive) + keyboard.
  useEffect(() => {
    const canvas = canvasEl.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView(zoomedView(useApp.getState().view, e.clientX - r.left, e.clientY - r.top, factor));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
        return;
      }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        doRedo();
        return;
      }
      if (mod && k === 'k') {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('[data-composer]')?.focus();
        return;
      }
      if (mod) return;
      const ui = useApp.getState().ui;
      switch (k) {
        case 'v':
          patchUi({ tool: 'select' });
          break;
        case 'h':
          patchUi({ tool: 'pan' });
          break;
        case 'w':
          patchUi({ tool: 'wall', draft: null });
          wallAnchor.current = null;
          break;
        case 'd':
          patchUi({ tool: 'door' });
          break;
        case 'n':
          patchUi({ tool: 'window' });
          break;
        case 'm':
          patchUi({ tool: 'measure', measure: null });
          break;
        case 'l':
          patchUi({ tool: ui.tool === 'library' ? 'select' : 'library' });
          break;
        case 'r':
          rotateSelected();
          break;
        case 'delete':
        case 'backspace':
          deleteSelected();
          break;
        case '/':
          e.preventDefault();
          document.querySelector<HTMLTextAreaElement>('[data-composer]')?.focus();
          break;
        case '+':
        case '=':
          zoomBy(1.2);
          break;
        case '-':
        case '_':
          zoomBy(1 / 1.2);
          break;
        case '0':
          rendererRef.current?.fit();
          break;
        case 'escape':
          cancelTool();
          break;
        case ' ':
          // Space-pan is tracked via keyup/down below; prevent scroll.
          e.preventDefault();
          break;
        default:
          break;
      }
    };
    const onSpaceDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        patchUi({ spacePan: true });
      }
    };
    const onSpaceUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') patchUi({ spacePan: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasEl}
      className="cv"
      aria-label="Floor plan canvas"
      onPointerDown={onPointerDown(drag, wallAnchor)}
      onPointerMove={onPointerMove(drag)}
      onPointerUp={onPointerUp(drag)}
      onPointerCancel={onPointerUp(drag)}
      onDoubleClick={onDoubleClick(wallAnchor)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function zoomBy(k: number): void {
  const canvas = canvasRef.current;
  const view = useApp.getState().view;
  const cx = canvas ? canvas.clientWidth / 2 : 400;
  const cy = canvas ? canvas.clientHeight / 2 : 300;
  setView(zoomedView(view, cx, cy, k));
}

function cancelTool(): void {
  const ui = useApp.getState().ui;
  if (ui.tool === 'library') {
    patchUi({ tool: 'select' });
    return;
  }
  if (ui.draft || ui.measure) {
    patchUi({ draft: null, measure: null });
    return;
  }
  patchUi({ selection: null });
}

export function rotateSelected(): void {
  const sel = useApp.getState().ui.selection;
  if (sel?.type !== 'item') return;
  const item = getLevel().items.find((i) => i.id === sel.id);
  if (!item) return;
  applyOpsToPlan([{ op: 'item.update', id: item.id, patch: { rot: (item.rot + 90) % 360 } }], `Rotate ${item.label}`, 'user', true);
}

export function deleteSelected(): void {
  const sel = useApp.getState().ui.selection;
  if (!sel) return;
  const level = getLevel();
  if (sel.type === 'item') {
    const item = level.items.find((i) => i.id === sel.id);
    if (!item) return;
    applyOpsToPlan([{ op: 'item.remove', id: item.id }], `Remove ${item.label}`, 'user', true);
  } else if (sel.type === 'wall') {
    applyOpsToPlan([{ op: 'wall.remove', id: sel.id }], 'Remove wall', 'user', true);
  } else if (sel.type === 'door' || sel.type === 'window') {
    applyOpsToPlan([{ op: 'opening.remove', id: sel.id }], `Remove ${sel.type}`, 'user', true);
  }
  patchUi({ selection: null });
}

function loc(e: React.PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(drag: React.MutableRefObject<DragState>, wallAnchor: React.MutableRefObject<Vec | null>) {
  return (e: React.PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    canvas.setPointerCapture(e.pointerId);
    const ui = useApp.getState().ui;
    const view = useApp.getState().view;
    const level = getLevel();
    const p = loc(e, canvas);
    const w = toWorld(e, canvas);

    // Two-pointer pinch.
    const pts = drag.current.pointers ?? new Map<number, { x: number; y: number }>();
    pts.set(e.pointerId, p);
    drag.current.pointers = pts;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      if (a && b) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        drag.current = {
          kind: 'pinch',
          pointers: pts,
          pinch: {
            dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
            s: view.s,
            wx: midX / view.s + view.x,
            wy: midY / view.s + view.y,
          },
        };
      }
      return;
    }

    if (e.button === 1 || ui.tool === 'pan' || ui.spacePan) {
      drag.current = { kind: 'pan', pointers: pts, panStart: { sx: p.x, sy: p.y, vx: view.x, vy: view.y } };
      return;
    }

    if (ui.tool === 'wall') {
      let pt: Vec = [snapGrid(w[0], e.altKey), snapGrid(w[1], e.altKey)];
      pt = endSnap(level, pt, view.s);
      const anchor = wallAnchor.current;
      if (anchor) {
        // Orthogonal lock within ~5°.
        const dx = pt[0] - anchor[0];
        const dy = pt[1] - anchor[1];
        const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 90;
        if (ang < 5 || ang > 85) {
          pt = Math.abs(dx) >= Math.abs(dy) ? [pt[0], anchor[1]] : [anchor[0], pt[1]];
        }
        const wall = { id: `w_${nanoid(4)}`, a: anchor, b: pt, thickness: 120 };
        const ok = applyOpsToPlan([{ op: 'wall.add', wall }], 'Draw wall', 'user', true);
        if (!ok) {
          toast('That wall is too short or too thin');
          return;
        }
        wallAnchor.current = pt;
        patchUi({ selection: { type: 'wall', id: wall.id }, draft: { a: pt, cur: null } });
      } else {
        wallAnchor.current = pt;
        patchUi({ draft: { a: pt, cur: null } });
      }
      return;
    }

    if (ui.tool === 'door' || ui.tool === 'window') {
      const hit = nearestWall(level, w, 4, view);
      if (!hit) {
        toast(`Click a wall to place the ${ui.tool}`);
        return;
      }
      const wall = level.walls.find((x) => x.id === hit.wallId);
      if (!wall) return;
      const width = ui.tool === 'door' ? 900 : 1200;
      const coords = wallCoords(wall, w);
      const at = Math.min(Math.max(coords.s, wall.thickness + width / 2), coords.L - wall.thickness - width / 2);
      const span: [number, number] = [at - width / 2, at + width / 2];
      const clash = level.openings.some((o) => {
        if (o.wall !== wall.id) return false;
        const [a, b] = [o.at - o.width / 2, o.at + o.width / 2];
        return span[0] < b + 50 && a - 50 < span[1];
      });
      if (clash || at - width / 2 < wall.thickness || at + width / 2 > coords.L - wall.thickness) {
        toast('That spot is taken by another opening');
        return;
      }
      const id = `${ui.tool === 'door' ? 'd' : 'n'}_${nanoid(4)}`;
      const opening =
        ui.tool === 'door'
          ? { kind: 'door' as const, id, wall: wall.id, at: Math.round(at), width, swing: (hit.o >= 0 ? 1 : -1) as 1 | -1, hinge: 'a' as const }
          : { kind: 'window' as const, id, wall: wall.id, at: Math.round(at), width };
      const ok = applyOpsToPlan([{ op: 'opening.add', opening }], `Add ${ui.tool}`, 'user', true);
      if (ok) patchUi({ selection: { type: ui.tool, id } });
      else toast('That spot is taken by another opening');
      return;
    }

    if (ui.tool === 'measure') {
      const pt: Vec = [Math.round(w[0]), Math.round(w[1])];
      const m = ui.measure;
      if (!m) patchUi({ measure: { a: pt, b: null } });
      else if (!m.b) patchUi({ measure: { a: m.a, b: pt } });
      else patchUi({ measure: { a: pt, b: null } });
      return;
    }

    if (ui.tool === 'select' || ui.tool === 'library') {
      const hit: Selection | null = hitTest(level, w, view);
      if (hit?.type === 'item') {
        const item = level.items.find((i) => i.id === hit.id);
        if (!item) return;
        patchUi({ selection: hit });
        drag.current = { kind: 'item', pointers: pts, itemId: item.id, before: { x: item.x, y: item.y }, moved: false, start: { ...p } };
      } else {
        if (hit) patchUi({ selection: hit });
        else patchUi({ selection: null });
        drag.current = { kind: 'pan', pointers: pts, panStart: { sx: p.x, sy: p.y, vx: view.x, vy: view.y } };
      }
    }
  };
}

function onPointerMove(drag: React.MutableRefObject<DragState>) {
  return (e: React.PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const ui = useApp.getState().ui;
    const p = loc(e, canvas);

    if (drag.current.pointers?.has(e.pointerId)) {
      drag.current.pointers.set(e.pointerId, p);
      if (drag.current.kind === 'pinch' && drag.current.pinch && drag.current.pointers.size >= 2) {
        const [a, b] = [...drag.current.pointers.values()];
        if (a && b) {
          const pin = drag.current.pinch;
          const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const s = Math.min(0.6, Math.max(0.015, (pin.s * dist) / pin.dist));
          setView({ s, x: pin.wx - midX / s, y: pin.wy - midY / s });
        }
        return;
      }
    }

    // Cursor + hover (cheap; renderer coalesces).
    const w = toWorld(e, canvas);
    if (ui.tool === 'measure' || ui.tool === 'wall') {
      patchUi({ cursor: [Math.round(w[0]), Math.round(w[1])] });
    }
    if (ui.tool === 'wall' && useApp.getState().ui.draft) {
      const d = useApp.getState().ui.draft;
      if (d) patchUi({ draft: { a: d.a, cur: [Math.round(w[0]), Math.round(w[1])] } });
    }

    const st = drag.current;
    if (st.kind === 'pan' && st.panStart) {
      const v = useApp.getState().view;
      setView({ ...v, x: st.panStart.vx - (p.x - st.panStart.sx) / v.s, y: st.panStart.vy - (p.y - st.panStart.sy) / v.s });
      return;
    }
    if (st.kind === 'item' && st.itemId) {
      // Start the drag past a 3 px threshold from the pointerdown anchor
      // (`start` is fixed; the live pointers map already tracks this move).
      const start = st.start;
      if (!st.moved) {
        if (!start || Math.hypot(p.x - start.x, p.y - start.y) < 3) return;
        st.moved = true;
        patchUi({ dragging: true });
      }
      const item: Item | undefined = getLevel().items.find((i) => i.id === st.itemId);
      if (!item) return;
      const nx = snapDrag(w[0], e.altKey);
      const ny = snapDrag(w[1], e.altKey);
      const ops: Op[] = [{ op: 'item.update', id: item.id, patch: { x: Math.round(nx), y: Math.round(ny) } }];
      try {
        const { level } = applyOps(getLevel(), ops);
        setPlanLevelSilent(level);
      } catch {
        // Invalid pose (non-finite); ignore this move.
      }
      return;
    }
    if (ui.tool === 'select' && st.kind === 'none') {
      const hit = hitTest(getLevel(), w, useApp.getState().view);
      const hv = hit && hit.type === 'item' ? hit : null;
      const cur = useApp.getState().ui.hover;
      if ((cur?.id ?? null) !== (hv?.id ?? null)) patchUi({ hover: hv });
    }
  };
}

function onPointerUp(drag: React.MutableRefObject<DragState>) {
  return (e: React.PointerEvent): void => {
    const st = drag.current;
    if (st.pointers) {
      st.pointers.delete(e.pointerId);
      if (st.pointers.size === 0) {
        if (st.kind === 'item' && st.moved && st.itemId && st.before) {
          const item = getLevel().items.find((i) => i.id === st.itemId);
          if (item) {
            const ops: Op[] = [{ op: 'item.update', id: item.id, patch: { x: item.x, y: item.y } }];
            const inverse: Op[] = [{ op: 'item.update', id: item.id, patch: { x: st.before.x, y: st.before.y } }];
            pushHistoryEntry({ id: `h_${nanoid(6)}`, label: `Move ${item.label}`, ops, inverse, source: 'user' });
          }
        }
        patchUi({ dragging: false });
        drag.current = { kind: 'none' };
      } else if (st.kind === 'pinch' && st.pointers.size === 1) {
        const [only] = [...st.pointers.values()];
        const v = useApp.getState().view;
        drag.current = {
          kind: 'pan',
          pointers: st.pointers,
          panStart: only ? { sx: only.x, sy: only.y, vx: v.x, vy: v.y } : undefined,
        };
      }
    } else {
      patchUi({ dragging: false });
      drag.current = { kind: 'none' };
    }
  };
}

function onDoubleClick(wallAnchor: React.MutableRefObject<Vec | null>) {
  return (): void => {
    if (useApp.getState().ui.tool === 'wall') {
      wallAnchor.current = null;
      patchUi({ draft: null });
    }
    if (useApp.getState().ui.tool === 'measure') {
      patchUi({ measure: null });
    }
  };
}
