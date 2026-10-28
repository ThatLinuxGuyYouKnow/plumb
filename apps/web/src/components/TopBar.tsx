import { useState } from 'react';
import { doRedo, doUndo, patchUi, planSummary, replacePlan, toast, useApp } from '../store.js';
import { listProjects, loadProject } from '../persist.js';

const THEME_ORDER = ['system', 'light', 'dark'] as const;

export interface TopBarProps {
  onExportJson: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportDxf: () => void;
  onExportIfc: () => void;
  onImportJson: (f: File) => void;
  onImportDxf: (f: File) => void;
  onNew: () => void;
}

export function TopBar(props: TopBarProps): JSX.Element {
  const plan = useApp((s) => s.plan);
  const undoLen = useApp((s) => s.history.undo.length);
  const redoLen = useApp((s) => s.history.redo.length);
  const theme = useApp((s) => s.ui.theme);
  const summary = planSummary(plan);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="wordmark" aria-label="Plumb home">Plumb</div>
      <nav className="crumbs" aria-label="Breadcrumb">{plan.name} · Level 1</nav>
      <div className="summary" aria-live="off">{summary.area} · {summary.rooms} rooms · {summary.items} pieces</div>
      <div className="top-actions">
        <button type="button" onClick={doUndo} disabled={undoLen === 0} aria-label="Undo" title="Undo (Ctrl+Z)">↩</button>
        <button type="button" onClick={doRedo} disabled={redoLen === 0} aria-label="Redo" title="Redo (Shift+Ctrl+Z)">↪</button>
        <button
          type="button"
          aria-label="Theme"
          title={`Theme: ${theme}`}
          onClick={() => {
            const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'system';
            patchUi({ theme: next });
            document.documentElement.dataset.theme = next === 'system' ? '' : next;
            if (next === 'system') document.documentElement.removeAttribute('data-theme');
          }}
        >◐</button>
        <details
          className="menu"
          open={menuOpen}
          onToggle={(e) => setMenuOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary aria-label="File menu">File</summary>
          <div className="menu-body">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onNew();
              }}
            >New plan</button>
            <ProjectsList />
            <button type="button" onClick={props.onExportJson}>Export .plumb.json</button>
            <button type="button" onClick={props.onExportSvg}>Export SVG</button>
            <button type="button" onClick={props.onExportPng}>Export PNG</button>
            <button type="button" onClick={props.onExportDxf}>Export DXF (CAD)</button>
            <button type="button" onClick={props.onExportIfc}>Export IFC (BIM)</button>
            <label className="import-label">Import .plumb.json
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) props.onImportJson(f);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="import-label">Import .dxf
              <input
                type="file"
                accept=".dxf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) props.onImportDxf(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </details>
      </div>
    </header>
  );
}

function ProjectsList(): JSX.Element {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; updated: number; thumbnail?: string }> | null>(null);
  return (
    <details
      className="submenu"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && projects === null) {
          void listProjects().then(setProjects, () => setProjects([]));
        }
      }}
    >
      <summary>Open project…</summary>
      <div className="projects">
        {projects === null && <span className="proj-empty">Loading…</span>}
        {projects !== null && projects.length === 0 && <span className="proj-empty">No saved projects yet.</span>}
        {projects?.map((p) => (
          <button
            key={p.id}
            type="button"
            className="proj-row"
            onClick={() => {
              void loadProject(p.id).then((plan) => {
                if (plan) {
                  replacePlan(plan);
                  toast(`Opened ${p.name}`);
                } else {
                  toast('Could not open that project');
                }
              });
            }}
          >
            {p.thumbnail && <img src={p.thumbnail} alt="" width={48} height={32} />}
            <span>{p.name}</span>
            <span className="mono">{new Date(p.updated).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

export function Toasts(): JSX.Element {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">{t.text}</div>
      ))}
    </div>
  );
}

export function ToolHint(): JSX.Element {
  const tool = useApp((s) => s.ui.tool);
  const hints: Record<string, string> = {
    select: 'Click to select · drag a piece to move · drag empty space to pan',
    pan: 'Drag to pan · wheel to zoom',
    wall: 'Click to place wall points · double-click or Esc to finish',
    door: 'Click a wall to add a 900 mm door · the side you click becomes the swing side',
    window: 'Click a wall to add a 1200 mm window',
    measure: 'Click two points · third click starts over',
    library: 'Pick a piece · it lands at the view centre',
  };
  return <div className="tool-hint">{hints[tool] ?? ''}</div>;
}

export function notify(msg: string): void {
  toast(msg);
}
