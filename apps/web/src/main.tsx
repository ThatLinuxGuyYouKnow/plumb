import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@plumb/render/tokens.css';
import { App } from './App.js';
import { useApp } from './store.js';

if (import.meta.env.DEV) {
  // E2E seam: lets Playwright map world coords and assert store state.
  const seam = { getState: useApp.getState } as Record<string, unknown>;
  (window as unknown as { __plumb: unknown }).__plumb = seam;
  void import('@plumb/render').then((render) => {
    seam.hitTest = render.hitTest;
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
