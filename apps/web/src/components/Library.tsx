/** Library popover: drawer thumbnails; clicking adds the item at the view centre. */
import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { CATALOG, type ItemType } from '@plumb/core';
import { DRAWERS, readTheme } from '@plumb/render';
import { applyOpsToPlan, patchUi, useApp } from '../store.js';
import { canvasRef } from '../canvas/CanvasView.js';

function Thumb(props: { type: ItemType }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const entry = CATALOG[props.type];
    const T = readTheme(document);
    const W = 96;
    const H = 72;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = T.panel;
    ctx.fillRect(0, 0, W, H);
    const s = Math.min((W - 16) / entry.w, (H - 16) / entry.d);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    DRAWERS[props.type](ctx, entry.w, entry.d, 14, T);
  }, [props.type]);
  return <canvas ref={ref} style={{ width: 96, height: 72 }} aria-hidden />;
}

export function Library(): JSX.Element | null {
  const tool = useApp((s) => s.ui.tool);
  if (tool !== 'library') return null;
  return (
    <div className="library" role="dialog" aria-label="Furniture library">
      <div className="lib-head">
        <h4>Library</h4>
        <button type="button" aria-label="Close library" onClick={() => patchUi({ tool: 'select' })}>✕</button>
      </div>
      <div className="lib-grid">
        {Object.values(CATALOG).map((entry) => (
          <button key={entry.type} type="button" className="lib-item" onClick={() => addAtCentre(entry.type)}>
            <Thumb type={entry.type} />
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function addAtCentre(type: ItemType): void {
  const entry = CATALOG[type];
  const canvas = canvasRef.current;
  const view = useApp.getState().view;
  const cx = canvas ? canvas.clientWidth / 2 : 400;
  const cy = canvas ? canvas.clientHeight / 2 : 300;
  const item = {
    id: `i_${nanoid(6)}`,
    type,
    label: entry.label,
    x: Math.round(cx / view.s + view.x),
    y: Math.round(cy / view.s + view.y),
    w: entry.w,
    d: entry.d,
    rot: 0,
  };
  const ok = applyOpsToPlan([{ op: 'item.add', item }], `Add ${entry.label}`, 'user', true);
  if (ok) patchUi({ selection: { type: 'item', id: item.id } });
}
