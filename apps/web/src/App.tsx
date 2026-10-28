import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { PlanSchema } from '@plumb/core';
import { exportSvg, serializePlumbFile, type DxfDocument } from '@plumb/io';
import { CanvasView, canvasRef } from './canvas/CanvasView.js';
import { TopBar, Toasts, ToolHint } from './components/TopBar.js';
import { ToolRail } from './components/ToolRail.js';
import { BottomBar } from './components/BottomBar.js';
import { Library } from './components/Library.js';
import { ImportPanel } from './components/ImportPanel.js';
import { AgentPanel } from './components/AgentPanel.js';
import { proactiveCheck } from './agent/client.js';
import { downloadBlob, exportDxf, exportIfc, parseDxfFile } from './convert.js';
import { getLevel, replacePlan, toast, useApp } from './store.js';
import { downloadText, lastOpenedId, loadProject, saveProject, validatedPlan, wireAutosave } from './persist.js';
import './app.css';

export function App(): JSX.Element {
  // Theme application.
  const theme = useApp((s) => s.ui.theme);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const [importDoc, setImportDoc] = useState<{ doc: DxfDocument; filename: string; nonce: number } | null>(null);

  // Restore last plan, then run the proactive check once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await lastOpenedId();
      if (id && !cancelled) {
        const plan = await loadProject(id);
        if (plan && !cancelled) replacePlan(plan);
      }
      if (!cancelled) void proactiveCheck();
    })();
    const unwire = wireAutosave(
      () => useApp.getState().plan,
      () => useApp.getState().plan.name,
      () => useApp.getState().plan.id,
    );
    return () => {
      cancelled = true;
      unwire();
    };
  }, []);

  return (
    <div className="app">
      <TopBar
        onNew={() => {
          const state = useApp.getState();
          const dirty = state.history.undo.length > 0;
          if (dirty && !window.confirm('Start a new blank plan? Your current plan is autosaved and can be reopened via File > Open project…')) {
            return;
          }
          void saveProject(state.plan.id, state.plan.name, state.plan).finally(() => {
            replacePlan({
              schemaVersion: 1,
              id: `plan_${nanoid(6)}`,
              name: 'Untitled plan',
              levels: [{ id: `level_${nanoid(6)}`, name: 'Level 1', walls: [], openings: [], rooms: [], items: [] }],
            });
            toast('Started a new blank plan');
          });
        }}
        onExportJson={() => downloadText('plan.plumb.json', serializePlumbFile(useApp.getState().plan), 'application/json')}
        onExportSvg={() => downloadText('plan.svg', exportSvg(getLevel()), 'image/svg+xml')}
        onExportPng={() => {
          canvasRef.current?.toBlob((b) => {
            if (!b) return;
            const url = URL.createObjectURL(b);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'plan.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          });
        }}
        onExportDxf={() => {
          void exportDxf(useApp.getState().plan).then(
            (blob) => downloadBlob('plan.dxf', blob),
            (e: unknown) =>
              toast(e instanceof Error && e.message === 'service' ? 'DXF needs the convert service (CONVERT_URL)' : 'DXF export failed'),
          );
        }}
        onExportIfc={() => {
          void exportIfc(useApp.getState().plan).then(
            (blob) => downloadBlob('plan.ifc', blob),
            (e: unknown) =>
              toast(e instanceof Error && e.message === 'service' ? 'IFC needs the convert service (CONVERT_URL)' : 'IFC export failed'),
          );
        }}
        onImportJson={(f) => {
          void f.text().then((text) => {
            const plan = validatedPlan(text);
            if (!plan) {
              toast('That file is not a valid .plumb.json');
              return;
            }
            try {
              replacePlan(PlanSchema.parse(plan));
              toast(`Imported ${plan.name}`);
            } catch {
              toast('That file failed validation');
            }
          });
        }}
        onImportDxf={(f) => {
          void parseDxfFile(f).then(
            (doc) => setImportDoc({ doc, filename: f.name, nonce: Date.now() }),
            (e: unknown) =>
              toast(e instanceof Error && e.message === 'service' ? 'DXF import needs the convert service (CONVERT_URL)' : 'Could not parse that DXF'),
          );
        }}
      />
      <ToolRail />
      <main className="stage">
        <CanvasView />
        <ToolHint />
        <Library />
        {importDoc && <ImportPanel key={importDoc.nonce} doc={importDoc.doc} filename={importDoc.filename} onClose={() => setImportDoc(null)} />}
        <BottomBar />
      </main>
      <AgentPanel />
      <Toasts />
    </div>
  );
}
