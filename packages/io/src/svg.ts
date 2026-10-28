/**
 * Client-side SVG export (vector, optional true-scale mode).
 * Layers follow the AIA naming used by the DXF export (SPEC §11).
 */
import { fmtArea, type Level } from '@plumb/core';
import { layoutRoomLabelsShim } from './svgHelpers.js';

export interface SvgExportOptions {
  /** When true, 1 mm = 1 SVG unit with no padding (true scale). */
  trueScale?: boolean;
  /** Background colour. Defaults to white for print. */
  background?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wallPath(w: { a: readonly [number, number]; b: readonly [number, number]; thickness: number }): string {
  const dx = w.b[0] - w.a[0];
  const dy = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const h = w.thickness / 2;
  const e = h; // square caps extended by half thickness
  const p = (s: number, o: number): string => `${(w.a[0] + ux * s + nx * o).toFixed(1)},${(w.a[1] + uy * s + ny * o).toFixed(1)}`;
  return `M${p(-e, -h)} L${p(len + e, -h)} L${p(len + e, h)} L${p(-e, h)} Z`;
}

/** Export a level to SVG. Pure. */
export function exportSvg(level: Level, opts: SvgExportOptions = {}): string {
  const pad = opts.trueScale ? 0 : 500;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of level.walls) {
    for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 1000;
    y1 = 1000;
  }
  const vx = x0 - pad;
  const vy = y0 - pad;
  const vw = x1 - x0 + pad * 2;
  const vh = y1 - y0 + pad * 2;
  const labels = layoutRoomLabelsShim(level);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" font-family="sans-serif">`,
  );
  if (opts.background) parts.push(`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${opts.background}"/>`);

  parts.push('<g id="A-FLOR">');
  for (const r of level.rooms) {
    parts.push(`<rect x="${r.rect.x}" y="${r.rect.y}" width="${r.rect.w}" height="${r.rect.h}" fill="none" stroke="#999" stroke-width="8"/>`);
  }
  parts.push('</g>');

  parts.push('<g id="A-WALL" fill="#222">');
  for (const w of level.walls) {
    parts.push(`<path d="${wallPath(w)}"/>`);
  }
  parts.push('</g>');

  parts.push('<g id="A-GLAZ" stroke="#222" fill="none" stroke-width="12">');
  for (const o of level.openings) {
    if (o.kind !== 'window') continue;
    const wall = level.walls.find((w) => w.id === o.wall);
    if (!wall) continue;
    const dx = wall.b[0] - wall.a[0];
    const dy = wall.b[1] - wall.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const x1p = wall.a[0] + ux * (o.at - o.width / 2);
    const y1p = wall.a[1] + uy * (o.at - o.width / 2);
    const x2p = wall.a[0] + ux * (o.at + o.width / 2);
    const y2p = wall.a[1] + uy * (o.at + o.width / 2);
    parts.push(`<line x1="${x1p.toFixed(1)}" y1="${y1p.toFixed(1)}" x2="${x2p.toFixed(1)}" y2="${y2p.toFixed(1)}"/>`);
  }
  parts.push('</g>');

  parts.push('<g id="A-DOOR" stroke="#222" fill="none" stroke-width="12">');
  for (const o of level.openings) {
    if (o.kind !== 'door') continue;
    const wall = level.walls.find((w) => w.id === o.wall);
    if (!wall) continue;
    const dx = wall.b[0] - wall.a[0];
    const dy = wall.b[1] - wall.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const cx = wall.a[0] + ux * o.at;
    const cy = wall.a[1] + uy * o.at;
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(o.width / 2).toFixed(1)}" stroke-dasharray="60,40"/>`);
  }
  parts.push('</g>');

  parts.push('<g id="A-FURN" stroke="#222" fill="none" stroke-width="12">');
  for (const item of level.items) {
    parts.push(
      `<g transform="translate(${item.x} ${item.y}) rotate(${item.rot})"><rect x="${-item.w / 2}" y="${-item.d / 2}" width="${item.w}" height="${item.d}"/><text x="0" y="0" text-anchor="middle" font-size="120" fill="#222" stroke="none">${esc(item.label)}</text></g>`,
    );
  }
  parts.push('</g>');

  parts.push('<g id="A-ANNO-TEXT" text-anchor="middle">');
  for (const r of level.rooms) {
    const lp = labels[r.id] ?? { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 };
    parts.push(
      `<text x="${lp.x.toFixed(0)}" y="${(lp.y - 60).toFixed(0)}" font-size="130" letter-spacing="2">${esc(r.name.toUpperCase())}</text>`,
    );
    parts.push(`<text x="${lp.x.toFixed(0)}" y="${(lp.y + 110).toFixed(0)}" font-size="170">${esc(fmtArea(r.rect.w * r.rect.h))}</text>`);
  }
  parts.push('</g>');

  parts.push('<g id="A-AREA" fill="none" stroke="#666" stroke-width="6">');
  for (const r of level.rooms) {
    parts.push(`<rect x="${r.rect.x}" y="${r.rect.y}" width="${r.rect.w}" height="${r.rect.h}"/>`);
  }
  parts.push('</g>');

  parts.push('</svg>');
  return parts.join('\n');
}
