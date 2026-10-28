/**
 * The frame (SPEC §7): world pass (floors → rugs → flash → walls → openings →
 * items → hover/selection/ghosts/draft) then screen-space overlays.
 */
import {
  FINISH_LABELS,
  doorGeometry,
  fmt,
  fmtArea,
  openingSpan,
  wallFrame,
  wallPoint,
  type Door,
  type Finish,
  type Item,
  type Level,
  type Wall,
  type Window,
} from '@plumb/core';
import { conflictsOf, hasConflict } from '@plumb/core';
import type { Theme } from './theme.js';
import { drawItem, itemOutlinePath } from './drawers.js';
import { previewOps } from './diff.js';
import { gridMajor, gridStep } from './grid.js';
import { scaleBarMm, levelBounds } from './fit.js';
import { layoutRoomLabels } from './labels.js';
import type { RendererState, UiState, ViewState } from './types.js';

type Ctx = CanvasRenderingContext2D;

export const UI_FONT = 'Geist, ui-sans-serif, system-ui, sans-serif';
export const MONO_FONT = "'Geist Mono', ui-monospace, monospace";

export interface DrawEnv {
  ctx: Ctx;
  /** CSS pixel width/height of the canvas. */
  W: number;
  H: number;
  T: Theme;
  /** performance.now() at draw time (dash march, mark pulse). */
  t: number;
  reduce: boolean;
}

function w2s(v: ViewState, x: number, y: number): [number, number] {
  return [(x - v.x) * v.s, (y - v.y) * v.s];
}

function label(
  ctx: Ctx,
  T: Theme,
  txt: string,
  x: number,
  y: number,
  font: string,
  color: string,
  halo?: string,
  ls?: string
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = ls ?? '0px';
  if (halo) {
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = halo;
    ctx.strokeText(txt, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function drawGrid(ctx: Ctx, T: Theme, view: ViewState, W: number, H: number): void {
  const s = view.s;
  const step = gridStep(s);
  const major = gridMajor(step);
  const x0 = Math.floor(view.x / step) * step;
  const x1 = view.x + W / s;
  const y0 = Math.floor(view.y / step) * step;
  const y1 = view.y + H / s;
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? T.gridB : T.gridA;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const isMajor = x % major === 0;
      if (pass === 1 !== isMajor) continue;
      const sx = Math.round((x - view.x) * s) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let y = y0; y <= y1; y += step) {
      const isMajor = y % major === 0;
      if (pass === 1 !== isMajor) continue;
      const sy = Math.round((y - view.y) * s) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();
  }
}

function floorPattern(
  ctx: Ctx,
  T: Theme,
  r: { x: number; y: number; w: number; h: number },
  floor: Finish,
  s: number,
  px: (n: number) => number
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = T.pat;
  ctx.lineWidth = px(1);
  ctx.beginPath();
  if (floor === 'timber' && 150 * s >= 3) {
    for (let y = r.y + 150; y < r.y + r.h; y += 150) {
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
  } else if (floor === 'tile' && 600 * s >= 6) {
    for (let y = r.y + 600; y < r.y + r.h; y += 600) {
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    for (let x = r.x + 600; x < r.x + r.w; x += 600) {
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
  } else if (floor === 'stone' && 300 * s >= 5) {
    for (let y = r.y + 300; y < r.y + r.h; y += 300) {
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    for (let x = r.x + 300; x < r.x + r.w; x += 300) {
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawWall(ctx: Ctx, T: Theme, w: Wall, level: Level): void {
  const { length } = wallFrame(w);
  const ops = level.openings
    .filter((o) => o.wall === w.id)
    .map(openingSpan)
    .sort((a, b) => a[0] - b[0]);
  let s0 = -w.thickness / 2;
  const segs: Array<[number, number]> = [];
  for (const [a, b] of ops) {
    if (a > s0) segs.push([s0, a]);
    s0 = Math.max(s0, b);
  }
  segs.push([s0, length + w.thickness / 2]);
  ctx.fillStyle = T.wall;
  for (const [a, b] of segs) {
    if (b - a <= 0) continue;
    const p = [
      wallPoint(w, a, -w.thickness / 2),
      wallPoint(w, b, -w.thickness / 2),
      wallPoint(w, b, w.thickness / 2),
      wallPoint(w, a, w.thickness / 2),
    ];
    ctx.beginPath();
    const first = p[0];
    if (!first) continue;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < 4; i++) {
      const q = p[i];
      if (q) ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawOpenings(ctx: Ctx, T: Theme, level: Level, px: (n: number) => number): void {
  for (const o of level.openings) {
    const wall = level.walls.find((w) => w.id === o.wall);
    if (!wall) continue;
    if (o.kind === 'window') {
      drawWindow(ctx, T, o, wall, px);
    } else {
      drawDoor(ctx, T, o, wall, px);
    }
  }
}

function drawWindow(
  ctx: Ctx,
  T: Theme,
  o: Window,
  wall: Wall,
  px: (n: number) => number
): void {
  const [a, b] = openingSpan(o);
  const t = wall.thickness;
  const p = [
    wallPoint(wall, a, -t / 2),
    wallPoint(wall, b, -t / 2),
    wallPoint(wall, b, t / 2),
    wallPoint(wall, a, t / 2),
  ];
  ctx.beginPath();
  const first = p[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < 4; i++) {
    const q = p[i];
    if (q) ctx.lineTo(q[0], q[1]);
  }
  ctx.closePath();
  ctx.fillStyle = T.glass;
  ctx.fill();
  ctx.strokeStyle = T.wall;
  ctx.lineWidth = px(1.2);
  ctx.stroke();
  for (const k of [-0.14, 0.14]) {
    const q1 = wallPoint(wall, a, t * k);
    const q2 = wallPoint(wall, b, t * k);
    ctx.beginPath();
    ctx.moveTo(q1[0], q1[1]);
    ctx.lineTo(q2[0], q2[1]);
    ctx.lineWidth = px(0.9);
    ctx.stroke();
  }
}

function drawDoor(ctx: Ctx, T: Theme, d: Door, wall: Wall, px: (n: number) => number): void {
  const g = doorGeometry(d, wall);
  const [a, b] = openingSpan(d);
  for (const s of [a, b]) {
    const q1 = wallPoint(wall, s, -wall.thickness / 2);
    const q2 = wallPoint(wall, s, wall.thickness / 2);
    ctx.beginPath();
    ctx.moveTo(q1[0], q1[1]);
    ctx.lineTo(q2[0], q2[1]);
    ctx.strokeStyle = T.wall;
    ctx.lineWidth = px(1.4);
    ctx.stroke();
  }
  ctx.strokeStyle = T.ink2;
  ctx.lineWidth = px(1.6);
  ctx.beginPath();
  ctx.moveTo(g.H[0], g.H[1]);
  ctx.lineTo(g.tip[0], g.tip[1]);
  ctx.stroke();
  const a0 = Math.atan2(g.uDir[1], g.uDir[0]);
  const a1 = Math.atan2(g.sv[1], g.sv[0]);
  const cross = g.uDir[0] * g.sv[1] - g.uDir[1] * g.sv[0];
  ctx.lineWidth = px(0.9);
  ctx.setLineDash([px(4), px(3)]);
  ctx.beginPath();
  ctx.arc(g.H[0], g.H[1], d.width, a0, a1, cross < 0);
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(ctx: Ctx, T: Theme, a: [number, number], b: [number, number], px: (n: number) => number): void {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const h = px(9);
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
  ctx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fillStyle = T.pen;
  ctx.fill();
}

function drawGhostExtras(ctx: Ctx, T: Theme, state: RendererState, px: (n: number) => number, t: number): void {
  const pr = state.agent.proposal;
  if (!pr || pr.status !== 'pending') return;
  const preview = previewOps(state.level, pr.ops);
  if (!preview) return;
  const { after, diff } = preview;
  ctx.lineJoin = 'round';
  const dash = (): void => {
    ctx.strokeStyle = T.pen;
    ctx.fillStyle = T.pen;
    ctx.lineWidth = px(1.6);
    ctx.setLineDash([px(6), px(4)]);
    ctx.lineDashOffset = -(t / 60) * px(1);
  };
  for (const item of diff.items.added) {
    drawItem(ctx, item, px(1.2), T, 0.6);
    dash();
    itemOutlinePath(ctx, item, 0);
    ctx.stroke();
  }
  for (const { before, after: afterItem } of diff.items.changed) {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = T.pen;
    ctx.lineWidth = px(1.6);
    itemOutlinePath(ctx, before, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawItem(ctx, afterItem, px(1.2), T, 0.62);
    dash();
    itemOutlinePath(ctx, afterItem, 0);
    ctx.stroke();
    if (Math.hypot(afterItem.x - before.x, afterItem.y - before.y) > 20) {
      arrow(ctx, T, [before.x, before.y], [afterItem.x, afterItem.y], px);
    }
  }
  for (const item of diff.items.removed) {
    dash();
    itemOutlinePath(ctx, item, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    const A = aabbOf(item);
    ctx.beginPath();
    ctx.moveTo(A.x0, A.y0);
    ctx.lineTo(A.x1, A.y1);
    ctx.moveTo(A.x1, A.y0);
    ctx.lineTo(A.x0, A.y1);
    ctx.stroke();
  }
  for (const rd of diff.rooms) {
    const rAfter = after.rooms.find((r) => r.id === rd.id);
    if (!rAfter) continue;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = T.floor[rAfter.floor] ?? T.floor.timber;
    ctx.fillRect(rAfter.rect.x, rAfter.rect.y, rAfter.rect.w, rAfter.rect.h);
    floorPattern(ctx, T, rAfter.rect, rAfter.floor, state.view.s, px);
    ctx.globalAlpha = 1;
    dash();
    ctx.beginPath();
    ctx.rect(rAfter.rect.x + px(1), rAfter.rect.y + px(1), rAfter.rect.w - px(2), rAfter.rect.h - px(2));
    ctx.stroke();
  }
  for (const rAfter of diff.roomsAdded) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = T.floor[rAfter.floor] ?? T.floor.timber;
    ctx.fillRect(rAfter.rect.x, rAfter.rect.y, rAfter.rect.w, rAfter.rect.h);
    floorPattern(ctx, T, rAfter.rect, rAfter.floor, state.view.s, px);
    ctx.globalAlpha = 1;
    dash();
    ctx.beginPath();
    ctx.rect(rAfter.rect.x + px(1), rAfter.rect.y + px(1), rAfter.rect.w - px(2), rAfter.rect.h - px(2));
    ctx.stroke();
  }
  for (const wd of diff.walls) {
    const wAfter = after.walls.find((w) => w.id === wd.id);
    if (!wAfter) continue;
    dash();
    wallRectPath(ctx, wAfter);
    ctx.stroke();
  }
  for (const wAfter of diff.wallsAdded) {
    dash();
    wallRectPath(ctx, wAfter);
    ctx.stroke();
  }
  for (const od of diff.openings) {
    const oAfter = after.openings.find((o) => o.id === od.id);
    const wall = oAfter ? after.walls.find((w) => w.id === oAfter.wall) : undefined;
    if (!oAfter || !wall) continue;
    const [a, b] = openingSpan(oAfter);
    const t2 = wall.thickness;
    const p = [
      wallPoint(wall, a, -t2 / 2),
      wallPoint(wall, b, -t2 / 2),
      wallPoint(wall, b, t2 / 2),
      wallPoint(wall, a, t2 / 2),
    ];
    dash();
    ctx.beginPath();
    const first = p[0];
    if (!first) continue;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < 4; i++) {
      const q = p[i];
      if (q) ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
  for (const oAfter of diff.openingsAdded) {
    const wall = after.walls.find((w) => w.id === oAfter.wall);
    if (!wall) continue;
    const [a, b] = openingSpan(oAfter);
    const t2 = wall.thickness;
    const p = [
      wallPoint(wall, a, -t2 / 2),
      wallPoint(wall, b, -t2 / 2),
      wallPoint(wall, b, t2 / 2),
      wallPoint(wall, a, t2 / 2),
    ];
    dash();
    ctx.beginPath();
    const first = p[0];
    if (!first) continue;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < 4; i++) {
      const q = p[i];
      if (q) ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function aabbOf(item: Pick<Item, 'w' | 'd' | 'rot' | 'x' | 'y'>): { x0: number; y0: number; x1: number; y1: number } {
  const a = Math.abs((item.rot * Math.PI) / 180);
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const hw = (item.w * c + item.d * s) / 2;
  const hd = (item.w * s + item.d * c) / 2;
  return { x0: item.x - hw, x1: item.x + hw, y0: item.y - hd, y1: item.y + hd };
}

function wallRectPath(ctx: Ctx, w: Wall): void {
  const { length } = wallFrame(w);
  const p = [
    wallPoint(w, -w.thickness / 2, -w.thickness / 2),
    wallPoint(w, length + w.thickness / 2, -w.thickness / 2),
    wallPoint(w, length + w.thickness / 2, w.thickness / 2),
    wallPoint(w, -w.thickness / 2, w.thickness / 2),
  ];
  ctx.beginPath();
  const first = p[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < 4; i++) {
    const q = p[i];
    if (q) ctx.lineTo(q[0], q[1]);
  }
  ctx.closePath();
}

function drawSelection(ctx: Ctx, T: Theme, state: RendererState, px: (n: number) => number): void {
  const sel = state.ui.selection;
  if (!sel) return;
  const level = state.level;
  ctx.strokeStyle = T.you;
  ctx.lineWidth = px(1.8);
  ctx.setLineDash([]);
  if (sel.type === 'item') {
    const it = level.items.find((i) => i.id === sel.id);
    if (!it) return;
    const bad = state.ui.dragging && hasConflict(conflictsOf(level, it));
    ctx.strokeStyle = bad ? T.pen : T.you;
    itemOutlinePath(ctx, it, px(4));
    ctx.stroke();
    const h = px(4);
    ctx.fillStyle = T.panel;
    const corners: ReadonlyArray<readonly [number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [sx, sy] of corners) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate((it.rot * Math.PI) / 180);
      ctx.beginPath();
      ctx.rect(sx * (it.w / 2 + px(4)) - h, sy * (it.d / 2 + px(4)) - h, h * 2, h * 2);
      ctx.restore();
      ctx.fill();
      ctx.stroke();
    }
  } else if (sel.type === 'room') {
    const r = level.rooms.find((x) => x.id === sel.id);
    if (r) ctx.strokeRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
  } else if (sel.type === 'wall') {
    const w = level.walls.find((x) => x.id === sel.id);
    if (w) {
      wallRectPath(ctx, w);
      ctx.stroke();
    }
  } else {
    const o = level.openings.find((x) => x.id === sel.id);
    const wall = o ? level.walls.find((w) => w.id === o.wall) : undefined;
    if (!o || !wall) return;
    const [a, b] = openingSpan(o);
    const t = wall.thickness;
    const p = [
      wallPoint(wall, a, -t / 2),
      wallPoint(wall, b, -t / 2),
      wallPoint(wall, b, t / 2),
      wallPoint(wall, a, t / 2),
    ];
    ctx.beginPath();
    const first = p[0];
    if (!first) return;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < 4; i++) {
      const q = p[i];
      if (q) ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawHover(ctx: Ctx, T: Theme, ui: UiState, level: Level, px: (n: number) => number): void {
  const hv = ui.hover;
  if (!hv || hv.type !== 'item') return;
  const it = level.items.find((i) => i.id === hv.id);
  if (!it) return;
  ctx.strokeStyle = T.you;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = px(1.4);
  itemOutlinePath(ctx, it, 0);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function dim(
  ctx: Ctx,
  T: Theme,
  view: ViewState,
  p1: [number, number],
  p2: [number, number],
  off: number,
  txt: string
): void {
  const a = w2s(view, p1[0], p1[1]);
  const b = w2s(view, p2[0], p2[1]);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 30) return;
  const ux = dx / L;
  const uy = dy / L;
  const nx = uy;
  const ny = -ux;
  const sg = Math.sign(off);
  ctx.strokeStyle = T.ink3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const p of [a, b]) {
    ctx.moveTo(p[0] + nx * sg * 6, p[1] + ny * sg * 6);
    ctx.lineTo(p[0] + nx * (off + sg * 5), p[1] + ny * (off + sg * 5));
  }
  const A: [number, number] = [a[0] + nx * off, a[1] + ny * off];
  const B: [number, number] = [b[0] + nx * off, b[1] + ny * off];
  ctx.moveTo(A[0], A[1]);
  ctx.lineTo(B[0], B[1]);
  const tx = (ux + nx) * 4;
  const ty = (uy + ny) * 4;
  for (const p of [A, B]) {
    ctx.moveTo(p[0] - tx, p[1] - ty);
    ctx.lineTo(p[0] + tx, p[1] + ty);
  }
  ctx.stroke();
  ctx.save();
  ctx.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
  let ang = Math.atan2(uy, ux);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  ctx.rotate(ang);
  ctx.font = `400 11px ${MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(txt).width + 10;
  ctx.fillStyle = T.cv;
  ctx.fillRect(-tw / 2, -8, tw, 16);
  ctx.fillStyle = T.ink2;
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

/** One full frame. */
export function draw(state: RendererState, env: DrawEnv): void {
  const { ctx, W, H, T, t, reduce } = env;
  const view = state.view;
  const level = state.level;
  const s = view.s;
  const px = (n: number): number => n / s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.cv;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, T, view, W, H);
  const labelPos = layoutRoomLabels(level);

  ctx.save();
  ctx.translate(-view.x * s, -view.y * s);
  ctx.scale(s, s);

  // rooms
  for (const r of level.rooms) {
    ctx.fillStyle = T.floor[r.floor] ?? T.floor.timber;
    ctx.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    floorPattern(ctx, T, r.rect, r.floor, s, px);
  }
  // rugs under everything
  for (const it of level.items) if (it.type === 'rug') drawItem(ctx, it, px(1.2), T);
  // flash highlights
  const flash = state.agent.flash;
  if (flash && Date.now() < flash.until) {
    for (const r of level.rooms) {
      if (!flash.roomIds.includes(r.id)) continue;
      ctx.fillStyle = T.penSoft;
      ctx.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
      ctx.strokeStyle = T.pen;
      ctx.lineWidth = px(2);
      ctx.strokeRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    }
  }
  // DXF-import underlay: read-only grey polylines under the plan.
  const underlay = state.ui.underlay;
  if (underlay && underlay.length) {
    ctx.strokeStyle = T.ink3;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = px(1.5);
    for (const line of underlay) {
      if (line.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(line[0]?.[0] ?? 0, line[0]?.[1] ?? 0);
      for (const p of line.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // walls, openings, items
  for (const w of level.walls) drawWall(ctx, T, w, level);
  drawOpenings(ctx, T, level, px);
  for (const it of level.items) if (it.type !== 'rug') drawItem(ctx, it, px(1.2), T);

  drawHover(ctx, T, state.ui, level, px);
  drawSelection(ctx, T, state, px);
  drawGhostExtras(ctx, T, state, px, t);

  // wall draft preview
  const draft = state.ui.draft;
  const draftCur = draft?.cur;
  if (draft && draftCur) {
    ctx.strokeStyle = T.you;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 120;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(draft.a[0], draft.a[1]);
    ctx.lineTo(draftCur[0], draftCur[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.you;
    ctx.beginPath();
    ctx.arc(draft.a[0], draft.a[1], px(4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ---- screen-space overlays ----
  for (const r of level.rooms) {
    const lp = labelPos[r.id];
    if (!lp || r.rect.w * s < 120) continue;
    const [sx, sy] = w2s(view, lp[0], lp[1]);
    const halo = T.floor[r.floor];
    label(ctx, T, r.name.toUpperCase(), sx, sy - 12, `500 10.5px ${UI_FONT}`, T.ink2, halo, '1.2px');
    label(ctx, T, fmtArea(r.rect.w * r.rect.h, state.ui.unit), sx, sy + 4, `500 14px ${UI_FONT}`, T.ink, halo);
    if (r.rect.w * s > 170) {
      label(
        ctx,
        T,
        `${fmt(r.rect.w, state.ui.unit)} × ${fmt(r.rect.h, state.ui.unit)}`,
        sx,
        sy + 21,
        `400 10.5px ${MONO_FONT}`,
        T.ink3,
        halo
      );
    }
  }

  // dimension lines: overall width and height
  const b = levelBounds(level);
  dim(ctx, T, view, [b.x0, b.y0], [b.x1, b.y0], -34, fmt(b.x1 - b.x0, state.ui.unit));
  dim(ctx, T, view, [b.x0, b.y1], [b.x0, b.y0], -34, fmt(b.y1 - b.y0, state.ui.unit));

  // drag readout
  const sel = state.ui.selection;
  if (sel?.type === 'item' && state.ui.dragging) {
    const it = level.items.find((i) => i.id === sel.id);
    if (it) {
      const p = w2s(view, it.x, it.y);
      label(
        ctx,
        T,
        `${fmt(it.x, state.ui.unit)} , ${fmt(it.y, state.ui.unit)}`,
        p[0],
        p[1] - (it.d * s) / 2 - 22,
        `500 11px ${MONO_FONT}`,
        T.you,
        T.cv
      );
    }
  }

  // proposal labels
  const pr = state.agent.proposal;
  if (pr && pr.status === 'pending') {
    const preview = previewOps(level, pr.ops);
    if (preview) {
      const unit = state.ui.unit;
      for (const m of preview.diff.moves) {
        const d = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
        if (d > 20) {
          const p = w2s(view, (m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2);
          label(ctx, T, fmt(d, unit), p[0], p[1] - 16, `500 11px ${MONO_FONT}`, T.pen, T.cv);
        }
      }
      for (const item of preview.diff.items.added) {
        const p = w2s(view, item.x, item.y);
        label(
          ctx,
          T,
          `+ ${item.label}`,
          p[0],
          p[1] - (Math.max(item.w, item.d) * s) / 2 - 12,
          `500 11px ${UI_FONT}`,
          T.pen,
          T.cv
        );
      }
      for (const rAfter of preview.diff.roomsAdded) {
        const p = w2s(view, rAfter.rect.x + rAfter.rect.w / 2, rAfter.rect.y + rAfter.rect.h - 380);
        label(
          ctx,
          T,
          `+ ${rAfter.name}`,
          p[0],
          p[1],
          `500 11px ${UI_FONT}`,
          T.pen,
          T.floor[rAfter.floor]
        );
      }
      for (const rd of preview.diff.rooms) {
        const rAfter = preview.after.rooms.find((r) => r.id === rd.id);
        if (!rAfter) continue;
        const p = w2s(view, rAfter.rect.x + rAfter.rect.w / 2, rAfter.rect.y + rAfter.rect.h - 380);
        label(
          ctx,
          T,
          `→ ${FINISH_LABELS[rAfter.floor]}`,
          p[0],
          p[1],
          `500 11px ${UI_FONT}`,
          T.pen,
          T.floor[rAfter.floor]
        );
      }
    }
  }

  // issue marks
  state.agent.marks.forEach((m, i) => {
    const p = w2s(view, m.x, m.y);
    const ph = reduce ? 0 : (t % 1400) / 1400;
    if (!reduce) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 12 + ph * 14, 0, Math.PI * 2);
      ctx.strokeStyle = T.pen;
      ctx.globalAlpha = (1 - ph) * 0.6;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
    ctx.fillStyle = T.pen;
    ctx.fill();
    label(ctx, T, String(i + 1), p[0], p[1] + 0.5, `600 12px ${UI_FONT}`, '#fff');
  });

  // measure
  const m = state.ui.measure;
  if (m) {
    const b2 = m.b ?? state.ui.cursor;
    if (b2) {
      const A = w2s(view, m.a[0], m.a[1]);
      const B = w2s(view, b2[0], b2[1]);
      ctx.strokeStyle = T.you;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.stroke();
      for (const p of [A, B]) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
        ctx.fillStyle = T.you;
        ctx.fill();
      }
      label(
        ctx,
        T,
        fmt(Math.hypot(b2[0] - m.a[0], b2[1] - m.a[1]), state.ui.unit),
        (A[0] + B[0]) / 2,
        (A[1] + B[1]) / 2 - 14,
        `500 12px ${MONO_FONT}`,
        T.you,
        T.cv
      );
    }
  }

  // wall-draft length
  const draftLen = state.ui.draft;
  const draftLenCur = draftLen?.cur;
  if (draftLen && draftLenCur) {
    const A = w2s(view, draftLen.a[0], draftLen.a[1]);
    const B = w2s(view, draftLenCur[0], draftLenCur[1]);
    label(
      ctx,
      T,
      fmt(Math.hypot(draftLenCur[0] - draftLen.a[0], draftLenCur[1] - draftLen.a[1]), state.ui.unit),
      (A[0] + B[0]) / 2,
      (A[1] + B[1]) / 2 - 16,
      `500 12px ${MONO_FONT}`,
      T.you,
      T.cv
    );
  }

  // scale bar + readout + north arrow
  const nice = scaleBarMm(s);
  const sb = nice * s;
  const bx = 16;
  const by = H - 62;
  ctx.strokeStyle = T.ink2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + sb, by);
  ctx.lineTo(bx + sb, by - 5);
  ctx.stroke();
  label(ctx, T, fmt(nice, state.ui.unit, nice < 1000 ? 1 : 0), bx + sb / 2, by - 12, `400 10.5px ${MONO_FONT}`, T.ink2, T.cv);
  const cx = W - 34;
  const cy = 44;
  ctx.strokeStyle = T.ink3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = T.ink;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx + 4.5, cy + 5);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx - 4.5, cy + 5);
  ctx.closePath();
  ctx.fill();
  label(ctx, T, 'N', cx, cy + 27, `500 10px ${UI_FONT}`, T.ink2, T.cv);
}
