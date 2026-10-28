/**
 * Furniture drawers: pure functions drawing in the item's local frame
 * (origin at centre, back is -y). Ported from the prototype's DRAW.
 * All read colours from the theme object.
 */
import type { Item, ItemType } from '@plumb/core';
import type { Theme } from './theme.js';

type Ctx = CanvasRenderingContext2D;
export type Drawer = (c: Ctx, w: number, d: number, lw: number, T: Theme) => void;

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}
function fs(c: Ctx, lw: number, T: Theme, fill?: string): void {
  c.fillStyle = fill ?? T.furn;
  c.strokeStyle = T.furnLine;
  c.lineWidth = lw;
  c.fill();
  c.stroke();
}
function ln(c: Ctx, x1: number, y1: number, x2: number, y2: number, lw: number, T: Theme): void {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.strokeStyle = T.furnLine;
  c.lineWidth = lw;
  c.stroke();
}
function circ(c: Ctx, x: number, y: number, r: number, lw: number, T: Theme, fill?: string): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  fs(c, lw, T, fill);
}

export const DRAWERS: Record<ItemType, Drawer> = {
  bed(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 50);
    fs(c, lw, T);
    const g = 120;
    const pw = (w - 3 * g) / 2;
    for (const k of [0, 1]) {
      rr(c, -w / 2 + g + k * (pw + g), -d / 2 + 130, pw, 420, 60);
      fs(c, lw, T, T.furn2);
    }
    rr(c, -w / 2 + 50, -d / 2 + 700, w - 100, d - 750, 40);
    fs(c, lw, T, T.furn2);
  },
  nightstand(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 25);
    fs(c, lw, T);
    circ(c, 0, 0, Math.min(w, d) * 0.2, lw, T, T.furn2);
  },
  wardrobe(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 15);
    fs(c, lw, T);
    ln(c, 0, -d / 2, 0, d / 2, lw, T);
    ln(c, -w / 2 + 60, -d / 2 + d * 0.45, w / 2 - 60, -d / 2 + d * 0.45, lw * 0.7, T);
    ln(c, -60, d / 2 - 110, -60, d / 2 - 40, lw, T);
    ln(c, 60, d / 2 - 110, 60, d / 2 - 40, lw, T);
  },
  dresser(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 15);
    fs(c, lw, T);
    for (let i = 1; i < 3; i++) ln(c, -w / 2 + (w * i) / 3, -d / 2, -w / 2 + (w * i) / 3, d / 2, lw, T);
  },
  sofa(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 80);
    fs(c, lw, T);
    rr(c, -w / 2, -d / 2, w, d * 0.3, 70);
    fs(c, lw, T, T.furn2);
    rr(c, -w / 2, -d / 2, w * 0.075, d, 50);
    fs(c, lw, T, T.furn2);
    rr(c, w / 2 - w * 0.075, -d / 2, w * 0.075, d, 50);
    fs(c, lw, T, T.furn2);
    for (let i = 1; i < 3; i++) {
      const x = -w / 2 + w * 0.075 + w * 0.85 * (i / 3);
      ln(c, x, -d / 2 + d * 0.3, x, d / 2 - 30, lw * 0.8, T);
    }
  },
  armchair(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 90);
    fs(c, lw, T);
    rr(c, -w / 2, -d / 2, w, d * 0.3, 70);
    fs(c, lw, T, T.furn2);
    rr(c, -w / 2, -d / 2, w * 0.14, d, 50);
    fs(c, lw, T, T.furn2);
    rr(c, w / 2 - w * 0.14, -d / 2, w * 0.14, d, 50);
    fs(c, lw, T, T.furn2);
  },
  coffee(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 60);
    fs(c, lw, T);
    rr(c, -w / 2 + 60, -d / 2 + 60, w - 120, d - 120, 30);
    c.strokeStyle = T.furnLine;
    c.lineWidth = lw * 0.6;
    c.stroke();
  },
  tv(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 20);
    fs(c, lw, T);
    rr(c, -w / 2 + 120, -d / 2 + 60, w - 240, 60, 10);
    fs(c, lw, T, T.furn2);
  },
  dining(c, w, d, lw, T) {
    const tw = w - 400;
    const td = d - 600;
    const xs: ReadonlyArray<number> = [-600, 0, 600];
    const ys: ReadonlyArray<number> = [-540, 540];
    for (const x of xs) {
      for (const y of ys) {
        rr(c, x - 200, y - 200, 400, 400, 70);
        fs(c, lw, T, T.furn2);
      }
    }
    rr(c, -tw / 2, -td / 2, tw, td, 40);
    fs(c, lw, T);
  },
  desk(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 20);
    fs(c, lw, T);
    rr(c, -170, -d / 2 + 60, 340, 50, 10);
    fs(c, lw, T, T.furn2);
    rr(c, -150, -d / 2 + 170, 300, 100, 10);
    fs(c, lw, T, T.furn2);
  },
  rug(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 80);
    c.fillStyle = T.furn2;
    c.globalAlpha *= 0.7;
    c.fill();
    c.globalAlpha /= 0.7;
    c.strokeStyle = T.furnLine;
    c.lineWidth = lw * 0.7;
    c.setLineDash([lw * 5, lw * 4]);
    c.stroke();
    c.setLineDash([]);
    rr(c, -w / 2 + 110, -d / 2 + 110, w - 220, d - 220, 50);
    c.lineWidth = lw * 0.6;
    c.stroke();
  },
  plant(c, w, d, lw, T) {
    circ(c, 0, 0, w / 2, lw, T);
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7;
      ln(c, 0, 0, Math.cos(a) * w * 0.46, Math.sin(a) * w * 0.46, lw * 0.8, T);
    }
    circ(c, 0, 0, w * 0.09, lw, T, T.furn2);
  },
  bathtub(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 90);
    fs(c, lw, T);
    rr(c, -w / 2 + 70, -d / 2 + 70, w - 140, d - 140, 120);
    fs(c, lw, T, T.furn2);
    circ(c, -w / 2 + 190, 0, 36, lw, T, T.furn);
    circ(c, w / 2 - 130, -d / 2 + 30, 22, lw, T, T.furn);
  },
  toilet(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d * 0.3, 20);
    fs(c, lw, T);
    c.beginPath();
    c.ellipse(0, d * 0.1, w * 0.4, d * 0.33, 0, 0, Math.PI * 2);
    fs(c, lw, T, T.furn2);
  },
  vanity(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 20);
    fs(c, lw, T);
    c.beginPath();
    c.ellipse(0, d * 0.05, w * 0.3, d * 0.28, 0, 0, Math.PI * 2);
    fs(c, lw, T, T.furn2);
    circ(c, 0, -d / 2 + 55, 18, lw, T);
  },
  counter(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 10);
    fs(c, lw, T);
    for (let x = -w / 2 + 600; x < w / 2 - 100; x += 600) ln(c, x, -d / 2, x, d / 2, lw * 0.7, T);
  },
  cooktop(c, w, d, lw, T) {
    DRAWERS.counter(c, w, d, lw, T);
    rr(c, -380, -d / 2 + 70, 760, d - 140, 20);
    fs(c, lw, T, T.furn2);
    const burners: ReadonlyArray<readonly [number, number]> = [
      [-190, -100],
      [190, -100],
      [-190, 110],
      [190, 110],
    ];
    for (const [x, y] of burners) {
      circ(c, x, y * 0.8, 95, lw, T, T.furn);
    }
  },
  sinkunit(c, w, d, lw, T) {
    DRAWERS.counter(c, w, d, lw, T);
    rr(c, -500, -d / 2 + 80, 420, d - 160, 40);
    fs(c, lw, T, T.furn2);
    rr(c, 0, -d / 2 + 80, 420, d - 160, 40);
    fs(c, lw, T, T.furn2);
    circ(c, -120, -d / 2 + 40, 18, lw, T);
  },
  fridge(c, w, d, lw, T) {
    rr(c, -w / 2, -d / 2, w, d, 25);
    fs(c, lw, T);
    ln(c, -w / 2, -d / 2 + d * 0.35, w / 2, -d / 2 + d * 0.35, lw, T);
    ln(c, w / 2 - 90, -d / 2 + d * 0.4, w / 2 - 90, -d / 2 + d * 0.7, lw * 1.4, T);
  },
  island(c, w, d, lw, T) {
    for (const x of [-w * 0.3, 0, w * 0.3]) circ(c, x, d / 2 + 190, 150, lw, T, T.furn2);
    rr(c, -w / 2, -d / 2, w, d, 40);
    fs(c, lw, T);
    rr(c, -w / 2 + 60, -d / 2 + 60, w - 120, d - 120, 20);
    c.strokeStyle = T.furnLine;
    c.lineWidth = lw * 0.6;
    c.stroke();
  },
};

/** Draw an item at its pose. `lw` is a world-space width (already divided by s). */
export function drawItem(
  c: Ctx,
  item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot' | 'type'>,
  lw: number,
  T: Theme,
  alpha?: number
): void {
  c.save();
  c.translate(item.x, item.y);
  c.rotate((item.rot * Math.PI) / 180);
  if (alpha !== undefined) c.globalAlpha = alpha;
  const drawer = DRAWERS[item.type];
  if (drawer) drawer(c, item.w, item.d, lw, T);
  else DRAWERS.counter(c, item.w, item.d, lw, T);
  c.restore();
}

/** Rect path (not stroked) around the item's oriented box plus `pad` mm. */
export function itemOutlinePath(c: Ctx, item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>, pad: number): void {
  c.save();
  c.translate(item.x, item.y);
  c.rotate((item.rot * Math.PI) / 180);
  c.beginPath();
  c.rect(-item.w / 2 - pad, -item.d / 2 - pad, item.w + pad * 2, item.d + pad * 2);
  c.restore();
}
