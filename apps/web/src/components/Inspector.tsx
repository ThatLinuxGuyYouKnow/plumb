/** Inspector: controlled inputs committing one history entry per change (SPEC §8). */
import { useState } from 'react';
import { nanoid } from 'nanoid';
import {
  CATALOG,
  FINISHES,
  FINISH_LABELS,
  conflictsOf,
  fmtArea,
  runChecks,
  toUnit,
  type Finish,
  type Item,
} from '@plumb/core';
import { applyOpsToPlan, getLevel, patchUi, useApp } from '../store.js';
import { deleteSelected, rotateSelected } from '../canvas/CanvasView.js';

function parseField(raw: string, unit: 'm' | 'ft'): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return unit === 'm' ? v * 1000 : v * 304.8;
}

function Num(props: { label: string; value: string; onCommit: (raw: string) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        step="0.01"
        value={draft ?? props.value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setDraft(null);
          if (e.target.value !== props.value) props.onCommit(e.target.value);
        }}
      />
    </label>
  );
}

function Text(props: { label: string; value: string; onCommit: (raw: string) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="text"
        value={draft ?? props.value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setDraft(null);
          if (e.target.value !== props.value) props.onCommit(e.target.value);
        }}
      />
    </label>
  );
}

export function Inspector(): JSX.Element | null {
  const sel = useApp((s) => s.ui.selection);
  const unit = useApp((s) => s.ui.unit);
  const plan = useApp((s) => s.plan);
  if (!sel) return null;
  const level = plan.levels[0];
  if (!level) return null;

  if (sel.type === 'item') {
    const item = level.items.find((i) => i.id === sel.id);
    if (!item) return null;
    const room = level.rooms.find(
      (r) => item.x >= r.rect.x && item.x <= r.rect.x + r.rect.w && item.y >= r.rect.y && item.y <= r.rect.y + r.rect.h,
    );
    const cf = conflictsOf(level, item);
    const issues = runChecks(level).filter((x) => x.itemIds.includes(item.id));
    const commit = (patch: Partial<Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot' | 'label'>>): void => {
      applyOpsToPlan([{ op: 'item.update', id: item.id, patch }], `Edit ${item.label}`, 'user', true);
    };
    return (
      <section className="inspector" aria-label="Inspector">
        <h4>{item.label}</h4>
        <Text label="Name" value={item.label} onCommit={(raw) => raw && commit({ label: raw })} />
        <div className="grid2">
          <Num label={unit === 'm' ? 'X (m)' : 'X (ft)'} value={toUnit(item.x, unit)} onCommit={(raw) => { const v = parseField(raw, unit); if (v !== null) commit({ x: Math.round(v) }); }} />
          <Num label={unit === 'm' ? 'Y (m)' : 'Y (ft)'} value={toUnit(item.y, unit)} onCommit={(raw) => { const v = parseField(raw, unit); if (v !== null) commit({ y: Math.round(v) }); }} />
          <Num label={unit === 'm' ? 'Width (m)' : 'Width (ft)'} value={toUnit(item.w, unit)} onCommit={(raw) => { const v = parseField(raw, unit); if (v !== null && v >= 100) commit({ w: Math.round(v) }); }} />
          <Num label={unit === 'm' ? 'Depth (m)' : 'Depth (ft)'} value={toUnit(item.d, unit)} onCommit={(raw) => { const v = parseField(raw, unit); if (v !== null && v >= 100) commit({ d: Math.round(v) }); }} />
        </div>
        <Num label="Rotation (°)" value={String(item.rot)} onCommit={(raw) => { const v = Number(raw); if (Number.isFinite(v)) commit({ rot: ((Math.round(v) % 360) + 360) % 360 }); }} />
        <div className="readonly">Room: {room?.name ?? '—'}</div>
        <div className="row">
          <button type="button" onClick={rotateSelected}>Rotate 90°</button>
          <button type="button" onClick={() => duplicateItem(item.id)}>Duplicate</button>
          <button type="button" onClick={deleteSelected}>Delete</button>
        </div>
        {(cf.overlaps.length > 0 || cf.swings.length > 0 || cf.outside || issues.length > 0) && (
          <div className="warn" role="alert">
            {issues.length ? issues.map((x) => x.message).join(' · ') : 'This piece conflicts with the plan.'}
          </div>
        )}
      </section>
    );
  }

  if (sel.type === 'room') {
    const room = level.rooms.find((r) => r.id === sel.id);
    if (!room) return null;
    return (
      <section className="inspector" aria-label="Inspector">
        <h4>{room.name}</h4>
        <Text
          label="Name"
          value={room.name}
          onCommit={(raw) => {
            if (raw) applyOpsToPlan([{ op: 'room.update', id: room.id, patch: { name: raw } }], 'Rename room', 'user', true);
          }}
        />
        <div className="readonly">Area: {fmtArea(room.rect.w * room.rect.h, unit)}</div>
        <div className="readonly">Size: {room.rect.w} × {room.rect.h} mm</div>
        <label className="field">
          <span>Floor finish</span>
          <select
            value={room.floor}
            onChange={(e) => {
              const floor = e.target.value as Finish;
              if (FINISHES.includes(floor)) {
                applyOpsToPlan([{ op: 'room.update', id: room.id, patch: { floor } }], `${room.name} floor`, 'user', true);
              }
            }}
          >
            {FINISHES.map((f) => (
              <option key={f} value={f}>{FINISH_LABELS[f]}</option>
            ))}
          </select>
        </label>
      </section>
    );
  }

  if (sel.type === 'wall') {
    const wall = level.walls.find((w) => w.id === sel.id);
    if (!wall) return null;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    return (
      <section className="inspector" aria-label="Inspector">
        <h4>Wall</h4>
        <Num
          label={unit === 'm' ? 'Length (m)' : 'Length (ft)'}
          value={toUnit(len, unit)}
          onCommit={(raw) => {
            const v = parseField(raw, unit);
            if (v === null || v < 1) return;
            const dx = wall.b[0] - wall.a[0];
            const dy = wall.b[1] - wall.a[1];
            const cur = Math.hypot(dx, dy) || 1;
            const b: [number, number] = [wall.a[0] + (dx / cur) * v, wall.a[1] + (dy / cur) * v];
            applyOpsToPlan([{ op: 'wall.update', id: wall.id, patch: { b } }], 'Resize wall', 'user', true);
          }}
        />
        <Num
          label="Thickness (mm)"
          value={String(wall.thickness)}
          onCommit={(raw) => {
            const v = Number(raw);
            if (Number.isFinite(v) && v >= 50 && v <= 600) {
              applyOpsToPlan([{ op: 'wall.update', id: wall.id, patch: { thickness: Math.round(v) } }], 'Wall thickness', 'user', true);
            }
          }}
        />
        <div className="row">
          <button type="button" onClick={deleteSelected}>Delete</button>
        </div>
      </section>
    );
  }

  const opening = level.openings.find((o) => o.id === sel.id);
  if (!opening) return null;
  return (
    <section className="inspector" aria-label="Inspector">
      <h4>{opening.kind === 'door' ? 'Door' : 'Window'}</h4>
      <Num
        label={unit === 'm' ? 'Width (m)' : 'Width (ft)'}
        value={toUnit(opening.width, unit)}
        onCommit={(raw) => {
          const v = parseField(raw, unit);
          if (v !== null && v >= 100) {
            applyOpsToPlan([{ op: 'opening.update', id: opening.id, patch: { width: Math.round(v) } }], 'Opening width', 'user', true);
          }
        }}
      />
      <Num
        label="Position along wall (mm)"
        value={String(Math.round(opening.at))}
        onCommit={(raw) => {
          const v = Number(raw);
          if (Number.isFinite(v)) {
            applyOpsToPlan([{ op: 'opening.update', id: opening.id, patch: { at: Math.round(v) } }], 'Move opening', 'user', true);
          }
        }}
      />
      {opening.kind === 'door' && (
        <div className="row">
          <button
            type="button"
            onClick={() => applyOpsToPlan([{ op: 'opening.update', id: opening.id, patch: { swing: opening.swing === 1 ? -1 : 1 } }], 'Flip swing', 'user', true)}
          >
            Flip swing
          </button>
          <button
            type="button"
            onClick={() => applyOpsToPlan([{ op: 'opening.update', id: opening.id, patch: { hinge: opening.hinge === 'a' ? 'b' : 'a' } }], 'Swap hinge', 'user', true)}
          >
            Swap hinge
          </button>
        </div>
      )}
      <div className="row">
        <button type="button" onClick={deleteSelected}>Delete</button>
      </div>
    </section>
  );
}

function duplicateItem(id: string): void {
  const item = getLevel().items.find((i) => i.id === id);
  if (!item) return;
  const entry = CATALOG[item.type];
  const copy = { ...item, id: `i_${nanoid(6)}`, x: item.x + 500, y: item.y, label: entry.label };
  const ok = applyOpsToPlan([{ op: 'item.add', item: copy }], `Duplicate ${item.label}`, 'user', true);
  if (ok) patchUi({ selection: { type: 'item', id: copy.id } });
}
