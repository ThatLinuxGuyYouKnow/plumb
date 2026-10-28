import { patchUi, useApp, type Tool } from '../store.js';

const TOOLS: Array<{ id: Tool; key: string; label: string; icon: string }> = [
  { id: 'select', key: 'V', label: 'Select', icon: '➤' },
  { id: 'pan', key: 'H', label: 'Pan', icon: '✥' },
  { id: 'wall', key: 'W', label: 'Wall', icon: '▬' },
  { id: 'door', key: 'D', label: 'Door', icon: '🚪' },
  { id: 'window', key: 'N', label: 'Window', icon: '🪟' },
  { id: 'measure', key: 'M', label: 'Measure', icon: '📏' },
  { id: 'library', key: 'L', label: 'Library', icon: '▦' },
];

export function ToolRail(): JSX.Element {
  const tool = useApp((s) => s.ui.tool);
  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          aria-label={`${t.label} (${t.key})`}
          title={`${t.label} (${t.key})`}
          className={tool === t.id ? 'active' : ''}
          onClick={() => patchUi({ tool: t.id })}
        >
          <span aria-hidden>{t.icon}</span>
        </button>
      ))}
    </nav>
  );
}
