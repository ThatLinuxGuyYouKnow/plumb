/** Local-first persistence (SPEC §12, M6): IndexedDB autosave + .plumb.json. */
import { openDB, type IDBPDatabase } from 'idb';
import { PlanSchema, type Plan } from '@plumb/core';
import { parsePlumbFile, serializePlumbFile } from '@plumb/io';

const DB = 'plumb';
const STORE = 'projects';

interface ProjectRow {
  id: string;
  name: string;
  updated: number;
  thumbnail?: string;
  file: string;
}

let db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (!db) {
    db = await openDB(DB, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
  }
  return db;
}

export async function saveProject(id: string, name: string, plan: Plan, thumbnail?: string): Promise<void> {
  const d = await getDb();
  const row: ProjectRow = { id, name, updated: Date.now(), thumbnail, file: serializePlumbFile(plan) };
  await d.put(STORE, row);
  try {
    localStorage.setItem('plumb.lastOpened', id);
  } catch {
    /* private mode */
  }
}

export async function loadProject(id: string): Promise<Plan | null> {
  const d = await getDb();
  const row = (await d.get(STORE, id)) as ProjectRow | undefined;
  if (!row) return null;
  try {
    return parsePlumbFile(row.file).plan;
  } catch {
    return null;
  }
}

export async function lastOpenedId(): Promise<string | null> {
  try {
    return localStorage.getItem('plumb.lastOpened');
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updated: number; thumbnail?: string }>> {
  const d = await getDb();
  const rows = ((await d.getAll(STORE)) as ProjectRow[]).sort((a, b) => b.updated - a.updated);
  return rows.map(({ id, name, updated, thumbnail }) => ({ id, name, updated, thumbnail }));
}

/** Wire debounced autosave (500 ms) for the current plan. Returns unsubscribe. */
export function wireAutosave(getPlan: () => Plan, getName: () => string, getId: () => string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const save = (): void => {
    const plan = getPlan();
    const serial = serializePlumbFile(plan);
    if (serial === last) return;
    last = serial;
    const canvas = document.querySelector<HTMLCanvasElement>('.cv');
    let thumbnail: string | undefined;
    try {
      if (canvas) {
        const small = document.createElement('canvas');
        small.width = 192;
        small.height = 128;
        const ctx = small.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, 0, 192, 128);
          thumbnail = small.toDataURL('image/png');
        }
      }
    } catch {
      thumbnail = undefined;
    }
    void saveProject(getId(), getName(), plan, thumbnail);
  };
  const id = window.setInterval(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      save();
    }, 500);
  }, 500);
  // Save immediately on hide/close.
  const onHide = (): void => save();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onHide);
  return () => {
    window.clearInterval(id);
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onHide);
  };
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validatedPlan(text: string): Plan | null {
  try {
    return parsePlumbFile(text).plan;
  } catch {
    return null;
  }
}

export { PlanSchema };
