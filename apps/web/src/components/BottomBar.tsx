import { fmt } from '@plumb/core';
import { scaleReadout } from '@plumb/render';
import { patchUi, useApp } from '../store.js';
import { rendererRef } from '../canvas/CanvasView.js';

function zoomCenter(k: number): void {
  const canvas = document.querySelector<HTMLCanvasElement>('.cv');
  const view = useApp.getState().view;
  const cx = canvas ? canvas.clientWidth / 2 : 400;
  const cy = canvas ? canvas.clientHeight / 2 : 300;
  const wx = cx / view.s + view.x;
  const wy = cy / view.s + view.y;
  const s = Math.min(0.6, Math.max(0.015, view.s * k));
  useApp.setState({ view: { s, x: wx - cx / s, y: wy - cy / s } });
}

export function BottomBar(): JSX.Element {
  const s = useApp((st) => st.view.s);
  const cursor = useApp((st) => st.ui.cursor);
  const snap = useApp((st) => st.ui.snap);
  const unit = useApp((st) => st.ui.unit);
  return (
    <div className="bottombar">
      <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.2)}>−</button>
      <span className="scale" aria-label="Scale">{scaleReadout(s)}</span>
      <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.2)}>+</button>
      <button type="button" aria-label="Fit plan" onClick={() => rendererRef.current?.fit()}>Fit</button>
      <span className="coords">{cursor ? `${fmt(cursor[0], unit)} , ${fmt(cursor[1], unit)}` : ''}</span>
      <button type="button" aria-pressed={snap} aria-label="Snap" title="Snap to grid" onClick={() => patchUi({ snap: !snap })}>
        ⬡ {snap ? 'on' : 'off'}
      </button>
      <button
        type="button"
        aria-label="Units"
        title="Toggle display unit"
        onClick={() => patchUi({ unit: unit === 'm' ? 'ft' : 'm' })}
      >
        {unit === 'm' ? 'm | ft' : 'ft | m'}
      </button>
    </div>
  );
}
