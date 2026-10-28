/**
 * Theme colours for the canvas: read from CSS custom properties into a plain
 * object whenever `data-theme` or `prefers-color-scheme` changes.
 * Never hard-code colours in the renderer (SPEC §3).
 */

export interface Theme {
  bg: string;
  panel: string;
  ink: string;
  ink2: string;
  ink3: string;
  cv: string;
  gridA: string;
  gridB: string;
  wall: string;
  furn: string;
  furn2: string;
  furnLine: string;
  glass: string;
  pat: string;
  you: string;
  pen: string;
  penSoft: string;
  ok: string;
  floor: { timber: string; tile: string; carpet: string; stone: string };
}

type Doc = Document;

function readVar(doc: Doc, name: string): string {
  return doc.documentElement.style.getPropertyValue(name) ||
    getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
}

export function readTheme(doc: Doc): Theme {
  const g = (n: string): string => readVar(doc, n);
  return {
    bg: g('--bg'),
    panel: g('--panel'),
    ink: g('--ink'),
    ink2: g('--ink-2'),
    ink3: g('--ink-3'),
    cv: g('--cv'),
    gridA: g('--grid-a'),
    gridB: g('--grid-b'),
    wall: g('--wall'),
    furn: g('--furn'),
    furn2: g('--furn-2'),
    furnLine: g('--furn-line'),
    glass: g('--glass'),
    pat: g('--pat'),
    you: g('--you'),
    pen: g('--pen'),
    penSoft: g('--pen-soft'),
    ok: g('--ok'),
    floor: {
      timber: g('--f-timber'),
      tile: g('--f-tile'),
      carpet: g('--f-carpet'),
      stone: g('--f-stone'),
    },
  };
}

/** Re-read the theme whenever it can change; returns a stop function. */
export function watchTheme(doc: Doc, onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  const onMq = (): void => onChange();
  mq?.addEventListener?.('change', onMq);
  return () => {
    mo.disconnect();
    mq?.removeEventListener?.('change', onMq);
  };
}
