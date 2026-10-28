/** Right panel: header, inspector, thread, chips, composer (SPEC §9). */
import { useState, type ReactNode } from 'react';
import type { Proposal } from '@plumb/core';
import { runChecks } from '@plumb/core';
import { Inspector } from './Inspector.js';
import { sendMessage } from '../agent/client.js';
import {
  applyOpsToPlan,
  doUndo,
  getLevel,
  patchUi,
  postMessage,
  setMarks,
  setProposal,
  setUnderlay,
  useApp,
} from '../store.js';

function statusOf(state: { busy: boolean; proposal: Proposal | null }): string {
  if (state.busy) return 'Working';
  if (state.proposal?.status === 'pending') return 'Waiting on you';
  return 'Idle';
}

export function AgentPanel(): JSX.Element {
  const messages = useApp((s) => s.agent.messages);
  const busy = useApp((s) => s.agent.busy);
  const proposal = useApp((s) => s.agent.proposal);
  const chips = useApp((s) => s.agent.chips);
  const [draft, setDraft] = useState('');

  return (
    <aside className="agent" aria-label="Agent panel">
      <div className="agent-head">
        <span className="agent-name">Plumb</span>
        <span className="agent-status" aria-live="polite">{statusOf({ busy, proposal })}</span>
      </div>
      <Inspector />
      <div className="thread" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'agent' && <div className="who">Plumb</div>}
            {m.steps && m.steps.length > 0 && (
              <ul className="steps">
                {m.steps.map((s, i) => (
                  <li key={i} className="done">✓ {s.name}{s.summary ? ` · ${s.summary}` : ''}</li>
                ))}
              </ul>
            )}
            {m.text && <div className="body"><MarkdownBody text={m.text} /></div>}
            {m.table && (
              <div className="rows">
                {m.table.map((row, i) => (
                  <div key={i} className={row[0] === 'Total net' ? 'tot' : ''}>
                    <span>{row[0]}</span><span className="mono">{row[1]}</span><span className="mono">{row[2]}</span>
                  </div>
                ))}
              </div>
            )}
            {m.proposalId && <ProposalCard id={m.proposalId} />}
          </div>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => void sendMessage(c)} disabled={busy}>{c}</button>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft;
          setDraft('');
          void sendMessage(text);
        }}
      >
        <textarea
          data-composer
          value={draft}
          rows={1}
          placeholder="Ask about the plan…"
          aria-label="Ask the agent"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const text = draft;
              setDraft('');
              void sendMessage(text);
            }
          }}
        />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}

/**
 * Minimal safe markdown for agent messages (bold, italic, code, headings,
 * bullet/numbered lists, fenced code blocks). React children escape HTML by
 * construction; no dangerouslySetInnerHTML anywhere.
 */
function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on `code`, **bold**, *italic* in one pass.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let n = 0;
  for (;;) {
    const m = re.exec(line);
    if (!m || m.index === undefined) break;
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    n += 1;
    if (tok.startsWith('`')) {
      out.push(<code key={`${keyPrefix}-${n}`}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyPrefix}-${n}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyPrefix}-${n}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out.length ? out : [line];
}

function MarkdownBody(props: { text: string }): JSX.Element {
  const blocks: ReactNode[] = [];
  const lines = props.text.split('\n');
  let i = 0;
  let key = 0;
  const pushPara = (buf: string[]): void => {
    if (!buf.length) return;
    key += 1;
    // Single newlines inside a paragraph become soft breaks.
    const kids: ReactNode[] = [];
    buf.forEach((ln, j) => {
      if (j > 0) kids.push(<br key={`br-${key}-${j}`} />);
      kids.push(...renderInline(ln, `p${key}-${j}`));
    });
    blocks.push(<p key={key}>{kids}</p>);
  };
  let para: string[] = [];
  const flush = (): void => {
    pushPara(para);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const t = line.trim();
    // Fenced code block.
    if (t.startsWith('```')) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // skip closing fence
      key += 1;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    // Heading.
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h && h[2] !== undefined) {
      flush();
      key += 1;
      blocks.push(<h4 key={key}>{renderInline(h[2], `h${key}`)}</h4>);
      i += 1;
      continue;
    }
    // Bullet list run.
    if (/^([-*•]\s+)/.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^([-*•]\s+)/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^([-*•]\s+)/, ''));
        i += 1;
      }
      key += 1;
      blocks.push(
        <ul key={key}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `b${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    // Numbered list run.
    if (/^\d+[.)]\s+/.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        i += 1;
      }
      key += 1;
      blocks.push(
        <ol key={key}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `n${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (t === '') {
      flush();
      i += 1;
      continue;
    }
    para.push(line);
    i += 1;
  }
  flush();
  return <>{blocks}</>;
}

function ProposalCard(props: { id: string }): JSX.Element | null {  const proposal = useApp((s) => s.agent.proposal);
  const history = useApp((s) => s.history);
  if (!proposal || proposal.id !== props.id) return null;
  const onTop = history.undo.length > 0 && history.undo[history.undo.length - 1]?.label.includes(proposal.title);
  return (
    <div className={`prop ${proposal.status === 'pending' ? '' : 'done'}`}>
      <h5>{proposal.title}</h5>
      <ul>{proposal.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
      {proposal.status === 'pending' ? (
        <div className="acts">
          <button type="button" className="go" onClick={() => applyProposal(proposal)}>Apply</button>
          <button type="button" className="no" onClick={() => { setProposal({ ...proposal, status: 'dismissed' }); setUnderlay([]); }}>Dismiss</button>
        </div>
      ) : (
        <div className="state">
          {proposal.status === 'applied' && (
            <span><b>Applied</b>{onTop && <button type="button" className="lnk" onClick={() => { doUndo(); setProposal({ ...proposal, status: 'undone' }); }}>Undo</button>}</span>
          )}
          {proposal.status === 'dismissed' && 'Dismissed'}
          {proposal.status === 'superseded' && 'Replaced by a newer proposal'}
          {proposal.status === 'undone' && 'Undone'}
        </div>
      )}
    </div>
  );
}

function applyProposal(proposal: Proposal): void {
  if (proposal.status !== 'pending') return;
  const source = proposal.title.startsWith('Import ') ? ('import' as const) : ('agent' as const);
  const ok = applyOpsToPlan(proposal.ops, proposal.title, source, true);
  if (!ok) return;
  setProposal({ ...proposal, status: 'applied' });
  setUnderlay([]);
  setMarks([]);
  // Select the main touched item.
  const touched = proposal.ops.map((o) => (o.op === 'item.add' ? o.item.id : o.op === 'item.update' ? o.id : null)).find(Boolean);
  if (touched && getLevel().items.some((i) => i.id === touched)) {
    patchUi({ selection: { type: 'item', id: touched } });
  }
  // Follow-up re-check.
  const issues = runChecks(getLevel());
  postMessage({
    role: 'agent',
    text: issues.length
      ? `Applied. ${issues.length} issue${issues.length > 1 ? 's' : ''} still open: ${issues.map((i) => i.message).join('; ')}.`
      : 'Applied. Re-checked the whole plan: no door-swing, overlap or wall conflicts.',
  });
  if (issues.length) {
    setMarks(issues.map((i) => ({ x: i.at[0], y: i.at[1] })));
  }
}
