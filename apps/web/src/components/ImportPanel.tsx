/**
 * DXF import review card (M9): reconstruct() heuristics with per-item
 * confidence checkboxes (low-confidence off by default), units note,
 * unmapped list, and the grey underlay. Confirming posts one pending
 * "Import …" proposal so the normal ghost preview + Apply path is used.
 */
import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { summarizeOp } from '@plumb/agent';
import { reconstruct, resetReconstructCounter, type DxfDocument, type ReconstructItem } from '@plumb/io';
import { getLevel, postMessage, setProposal, setUnderlay } from '../store.js';

export function ImportPanel(props: { doc: DxfDocument; filename: string; onClose: () => void }): JSX.Element | null {
  const result = useMemo(() => {
    resetReconstructCounter();
    return reconstruct(props.doc);
  }, [props.doc]);
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(result.items.map((item, i) => (item.onByDefault ? i : -1)).filter((i) => i >= 0)),
  );
  if (!result.items.length && !result.underlay.length) {
    return (
      <div className="library" role="dialog" aria-label="DXF import">
        <div className="lib-head">
          <h4>Import {props.filename}</h4>
          <button type="button" aria-label="Close import" onClick={props.onClose}>✕</button>
        </div>
        <p className="import-note">Nothing recognisable in this file{result.unmapped.length ? `: ${result.unmapped.join(', ')}` : ''}.</p>
      </div>
    );
  }
  const toggle = (i: number): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const confirm = (): void => {
    const picked: ReconstructItem[] = result.items.filter((_, i) => checked.has(i));
    const ops = picked.flatMap((p) => [p.op]);
    if (!ops.length) return;
    const level = getLevel();
    setUnderlay(result.underlay);
    setProposal({
      id: `p_${nanoid(6)}`,
      title: `Import ${props.filename}`,
      rationale: `${picked.length} of ${result.items.length} recognised entities; units ${result.unitsputer.from}.`,
      ops,
      status: 'pending',
      summary: ops.map((o) => summarizeOp(o, level)),
    });
    postMessage({
      role: 'agent',
      text: `Parsed ${props.filename}: ${picked.length} entit${picked.length === 1 ? 'y' : 'ies'} ready to apply (units ${result.unitsputer.from}${result.unitsputer.confirm ? '; please confirm the scale against a known dimension' : ''}). Review the red ghosts, then Apply.`,
    });
    props.onClose();
  };
  return (
    <div className="library" role="dialog" aria-label="DXF import">
      <div className="lib-head">
        <h4>Import {props.filename}</h4>
        <button type="button" aria-label="Close import" onClick={props.onClose}>✕</button>
      </div>
      <p className="import-note">
        Units: {result.unitsputer.from}
        {result.unitsputer.confirm ? ' — please confirm against a known dimension.' : ' — no confirmation needed.'}
      </p>
      <div className="lib-grid import-list">
        {result.items.map((item, i) => (
          <label key={i} className="import-row">
            <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
            <span>{item.note}</span>
            <span className="mono">{Math.round(item.confidence * 100)}%</span>
          </label>
        ))}
      </div>
      {result.unmapped.length > 0 && (
        <p className="import-note">Unmapped (kept as grey underlay): {result.unmapped.slice(0, 6).join(', ')}{result.unmapped.length > 6 ? '…' : ''}</p>
      )}
      <div className="lib-head">
        <button type="button" className="go" onClick={confirm} disabled={checked.size === 0}>
          Propose {checked.size} entit{checked.size === 1 ? 'y' : 'ies'}
        </button>
      </div>
    </div>
  );
}
