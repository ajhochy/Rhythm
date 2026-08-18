import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useGateway } from '../gateway/context';
import { SessionGatewayError, type SessionFileContent, type SessionFileEntry, type SessionFileStatusEntry } from '../gateway/sessions';
import { useFixtures } from '../store';
import type { FixtureFile, InspectorTab, Session } from '../types';
import { FocusDialog } from './FocusDialog';
import { navigate } from './Shell';

const tabs: { id: InspectorTab; label: string; icon: 'activity' | 'diff' | 'terminal' | 'file' | 'artifact' }[] = [
  { id: 'context', label: 'Context', icon: 'activity' }, { id: 'changes', label: 'Changes', icon: 'diff' }, { id: 'terminal', label: 'Terminal', icon: 'terminal' }, { id: 'files', label: 'Files', icon: 'file' }, { id: 'artifacts', label: 'Artifacts', icon: 'artifact' },
];

type InspectorTrace = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'WS'; route: string };
type PtyFixture = { id: string; status: 'connecting' | 'connected' | 'exited' | 'error'; output: string[] };

function Trace({ trace }: { trace: InspectorTrace | null }) {
  if (!trace) return null;
  return <output className="inspector-trace" data-testid="inspector-trace"><strong>{trace.method}</strong> {trace.route}</output>;
}

function ContextPanel() {
  const { selected, profiles } = useFixtures();
  const profile = profiles.find((item) => item.id === selected.profileId);
  const total = selected.inputTokens + selected.outputTokens + selected.cachedTokens;
  const pct = Math.min(100, Math.round((total / selected.totalBudget) * 100));
  return <section className="inspector-panel" aria-label="Session context" data-testid="context-panel">
    <div className="context-path"><Icon name="worktree" /><div><strong>{selected.cwd}</strong><small>{selected.isolateWorktree ? 'Isolated worktree' : 'Project workspace'} · {selected.dirtyCount} changed</small></div></div>
    <div className="token-gauge" aria-label={`${pct}% of context budget used`}><div><strong>{total.toLocaleString()}</strong><small>of {selected.totalBudget.toLocaleString()} tokens</small></div><span><i style={{ width: `${pct}%` }} /></span><em>{pct}%</em></div>
    <dl className="property-list"><div><dt>Provider</dt><dd>{profile?.modelProvider ?? selected.providerId ?? 'Configured'}</dd></div><div><dt>Agent</dt><dd>{profile?.label ?? selected.profileId}</dd></div><div><dt>Model</dt><dd>{selected.modelId ?? profile?.modelId ?? selected.model}</dd></div><div><dt>Usage budget</dt><dd>$2.00 session cap</dd></div><div><dt>Total cost</dt><dd>${selected.cost.toFixed(3)}</dd></div><div><dt>Input</dt><dd>{selected.inputTokens.toLocaleString()}</dd></div><div><dt>Output</dt><dd>{selected.outputTokens.toLocaleString()}</dd></div><div><dt>Cached</dt><dd>{selected.cachedTokens.toLocaleString()}</dd></div><div><dt>Created</dt><dd>Aug 12 · {selected.createdAt.slice(11, 16)}</dd></div><div><dt>Updated</dt><dd>Aug 12 · {selected.updatedAt.slice(11, 16)}</dd></div><div><dt>Messages</dt><dd>{selected.messages.length}</dd></div><div><dt>Worktree</dt><dd>{selected.isolateWorktree ? 'Isolated' : 'Current workspace'}</dd></div>
      {/* post-m1-phase-6 c3b: the resolved isolated-worktree branch — never defaulted to 'main'. */}
      {selected.worktreeBranch && <div><dt>Worktree branch</dt><dd>{selected.worktreeBranch}</dd></div>}
    </dl>
    <div className="memory-provenance"><h3>Memory provenance</h3><p>Project memory · services/run-sheet.md</p><p>Session summary · fixed fixture clock</p><p>Profile prompt · {selected.profileId}</p></div>
  </section>;
}

const diffEntries = [
  { path: 'services/2026-08-16/run-sheet.md', additions: 2, deletions: 1, patch: '+ Confirm acoustic guitar coverage\n+ Assign livestream fallback owner\n- Placeholder: hospitality lead' },
  { path: 'services/2026-08-16/owners.md', additions: 1, deletions: 0, patch: '+ Livestream fallback: unresolved' },
];

function ChangesPanel({ trace, setTrace }: { trace: InspectorTrace | null; setTrace(trace: InspectorTrace): void }) {
  const { selected, diff, resetWorktree, removeWorktree, revertSession, unrevertSession, notify } = useFixtures();
  const [confirm, setConfirm] = useState<'reset' | 'remove' | 'revert' | 'restore' | null>(null);
  const [scope, setScope] = useState<'session' | 'git' | 'branch'>('session');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [diffEntries[0].path]: true });
  const firstUserMessage = selected.messages.find((message) => message.role === 'user');
  const canRevert = scope === 'session' && Boolean(firstUserMessage) && !selected.revertedMessageId;
  const canRestore = scope === 'session' && Boolean(selected.revertedMessageId);
  const setDiffScope = (next: 'session' | 'git' | 'branch') => {
    setScope(next);
    const mode = next === 'branch' ? 'branch' : 'git';
    setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/vcs/diff?mode=${mode}` });
  };
  const confirmAction = () => {
    if (confirm === 'reset') { resetWorktree(); setTrace({ method: 'POST', route: `/agent-sessions/${selected.id}/worktree/reset` }); }
    if (confirm === 'remove') { removeWorktree(); setTrace({ method: 'POST', route: `/agent-sessions/${selected.id}/worktree/remove` }); }
    if (confirm === 'revert' && firstUserMessage) { revertSession(selected.id, firstUserMessage.id); setTrace({ method: 'POST', route: `/agent-sessions/${selected.id}/revert` }); }
    if (confirm === 'restore') { unrevertSession(selected.id); setTrace({ method: 'POST', route: `/agent-sessions/${selected.id}/unrevert` }); }
    setConfirm(null);
  };
  return <section className="inspector-panel changes-panel" aria-label="Session changes" data-testid="changes-panel">
    <div className="changes-summary"><span><strong>{scope === 'branch' ? 4 : diffEntries.length}</strong> changed files</span><small>{scope === 'session' ? 'This session' : scope === 'git' ? 'All uncommitted' : 'vs main'}</small></div>
    <div className="segmented-control changes-scopes" role="group" aria-label="Changes scope">
      <button type="button" aria-pressed={scope === 'session'} onClick={() => setDiffScope('session')} data-testid="changes-scope-session">This session</button>
      <button type="button" aria-pressed={scope === 'git'} onClick={() => setDiffScope('git')} data-testid="changes-scope-git">All uncommitted</button>
      <button type="button" aria-pressed={scope === 'branch'} onClick={() => setDiffScope('branch')} data-testid="changes-scope-branch">vs default branch</button>
    </div>
    <div className="change-file-list">
      {diffEntries.map((entry) => <article key={entry.path} className="change-file">
        <button type="button" aria-expanded={Boolean(expanded[entry.path])} onClick={() => setExpanded((current) => ({ ...current, [entry.path]: !current[entry.path] }))} data-testid={`change-file-${entry.path.replace(/[^a-z0-9]/gi, '-')}`}>
          <Icon name="chevronRight" size={13} /><code>{entry.path}</code><span>+{entry.additions} −{entry.deletions}</span>
        </button>
        {expanded[entry.path] && <pre className="diff-code">{entry.path === diffEntries[0].path ? diff : entry.patch}</pre>}
      </article>)}
    </div>
    <div className="inspector-actions changes-actions">
      <button className="secondary-button" type="button" onClick={() => { notify('Patch exported as session.patch'); setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/vcs/diff/raw` }); }} data-testid="changes-export">Export patch</button>
      {canRestore ? <button className="secondary-button" type="button" onClick={() => setConfirm('restore')} data-testid="changes-restore">Restore</button> : <button className="secondary-button" type="button" disabled={!canRevert} title={!firstUserMessage ? 'No user message is available to revert to' : scope !== 'session' ? 'Revert is available for This session only' : undefined} onClick={() => setConfirm('revert')} data-testid="changes-revert">Revert</button>}
    </div>
    <div className="inspector-actions worktree-actions">
      <button className="secondary-button" type="button" disabled={!selected.isolateWorktree} onClick={() => setConfirm('reset')} data-testid="worktree-reset">Reset changes</button>
      <button className="text-danger-button" type="button" disabled={!selected.isolateWorktree || selected.status !== 'closed'} title={selected.status !== 'closed' ? 'Close the session before removing its worktree' : undefined} onClick={() => setConfirm('remove')} data-testid="worktree-remove">Remove worktree</button>
    </div>
    <Trace trace={trace} />
    <FocusDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'reset' ? 'Reset worktree?' : confirm === 'remove' ? 'Remove worktree?' : confirm === 'restore' ? 'Restore reverted history?' : 'Revert to the first user message?'} description="This changes the local workspace only." testId="worktree-confirm-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(null)}>Cancel</button><button className="danger-button" type="button" onClick={confirmAction} data-testid="worktree-confirm">Confirm</button></div></FocusDialog>
  </section>;
}

function terminalResult(command: string) {
  const results: Record<string, string> = { pwd: '/workspace/rhythm', 'git status --short': ' M services/2026-08-16/run-sheet.md', 'npm test': '26 tests discovered · browser verification required' };
  return results[command] ?? `fixture: ${command} completed`;
}

function TerminalPanel({ pty, updatePty, trace, setTrace }: { pty: PtyFixture; updatePty(next: PtyFixture): void; trace: InspectorTrace | null; setTrace(trace: InspectorTrace): void }) {
  const { selected, notify } = useFixtures();
  const [command, setCommand] = useState('git status --short');
  const runCommand = () => {
    const nextCommand = command.trim();
    if (!nextCommand || pty.status !== 'connected') return;
    if (nextCommand === 'exit') {
      updatePty({ ...pty, status: 'exited', output: [...pty.output, '$ exit', '[process exited]'] });
      setTrace({ method: 'DELETE', route: `/pty/${pty.id}` });
    } else if (nextCommand === 'fail-pty') {
      updatePty({ ...pty, status: 'error', output: [...pty.output, '$ fail-pty', 'PTY stream disconnected'] });
      setTrace({ method: 'WS', route: `/ws/pty/${pty.id}` });
    } else {
      updatePty({ ...pty, output: [...pty.output, `$ ${nextCommand}`, terminalResult(nextCommand)] });
      setTrace({ method: 'WS', route: `/ws/pty/${pty.id}` });
      notify('Fixture terminal command completed');
    }
    setCommand('');
  };
  const openTerminal = () => {
    const nextId = `pty-${selected.id}-2`;
    updatePty({ id: nextId, status: 'connected', output: ['$ pwd', selected.cwd] });
    setTrace({ method: 'POST', route: `/agent-sessions/${selected.id}/pty` });
  };
  return <section className="inspector-panel terminal-panel" aria-label="Session terminal" data-testid="terminal-panel">
    <header><span><span className={`status-dot ${pty.status === 'connected' ? 'working' : pty.status === 'connecting' ? 'retrying' : 'offline'}`} />PTY · {pty.status}</span></header>
    <pre aria-live="polite" data-testid="terminal-output">{pty.output.join('\n')}</pre>
    {pty.status === 'connected' && <><form onSubmit={(event) => { event.preventDefault(); runCommand(); }}><label><span aria-hidden="true">$</span><input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Terminal command" placeholder="Enter terminal command" data-testid="terminal-input" /></label><button className="primary-button" type="submit" data-testid="terminal-run">Run</button></form><div className="command-chips"><button type="button" onClick={() => setCommand('pwd')}>pwd</button><button type="button" onClick={() => setCommand('git status --short')}>git status</button><button type="button" onClick={() => setCommand('npm test')}>npm test</button><button type="button" onClick={() => setCommand('exit')}>exit</button></div></>}
    {pty.status === 'exited' && <div className="terminal-recovery"><p>[process exited]</p><button className="secondary-button" type="button" onClick={openTerminal} data-testid="terminal-new">New terminal</button></div>}
    {pty.status === 'error' && <div className="terminal-recovery"><p>Terminal connection failed.</p><button className="secondary-button" type="button" onClick={() => { updatePty({ ...pty, status: 'connected' }); setTrace({ method: 'WS', route: `/ws/pty/${pty.id}` }); }} data-testid="terminal-retry">Retry</button></div>}
    {pty.status === 'connecting' && <p className="inspector-state" aria-live="polite">Connecting to terminal…</p>}
    <Trace trace={trace} />
  </section>;
}

const slug = (value: string) => value.replace(/[^a-z0-9]/gi, '-');

function FilesPanel({ trace, setTrace }: { trace: InspectorTrace | null; setTrace(trace: InspectorTrace): void }) {
  const { selected, files, activeFile, setActiveFile, notify } = useFixtures();
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState('');
  const [previewPath, setPreviewPath] = useState(activeFile);
  const prefix = directory ? `${directory}/` : '';
  const matches = query ? files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())) : [];
  const directories = query ? [] : [...new Set(files.filter((file) => file.path.startsWith(prefix)).map((file) => file.path.slice(prefix.length).split('/')).filter((parts) => parts.length > 1).map((parts) => parts[0]))];
  const visibleFiles = query ? matches : files.filter((file) => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes('/'));
  const current = files.find((file) => file.path === previewPath);
  const openFile = (file: FixtureFile) => {
    setActiveFile(file.path); setPreviewPath(file.path);
    setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/files/content?path=${encodeURIComponent(file.path)}` });
  };
  const openDirectory = (name: string) => {
    const next = prefix + name;
    setDirectory(next); setPreviewPath('');
    setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/files/list?path=${encodeURIComponent(next)}` });
  };
  const renderPreview = () => {
    if (!current) return <div className="inspector-empty file-empty"><Icon name="file" size={22} /><h3>Select a file</h3><p>Text, image, and binary previews stay inside the session workspace.</p></div>;
    if ((current.size ?? 0) > 2_000_000) return <div className="file-guard" role="status"><strong>Preview unavailable</strong><p>File exceeds the 2 MB preview limit.</p></div>;
    if (current.kind === 'binary') return <div className="file-guard" role="status"><strong>Binary file</strong><p>{current.mimeType} · {(current.size ?? 0).toLocaleString()} bytes</p></div>;
    if (current.kind === 'image') return <div className="image-preview"><img src={current.previewUrl} alt={`Preview of ${current.path}`} /><p>{current.mimeType} · {(current.size ?? 0).toLocaleString()} bytes</p></div>;
    return <pre>{current.content || 'This fixture file has no previewable content.'}</pre>;
  };
  return <section className="inspector-panel files-panel" aria-label="Session files" data-testid="files-panel">
    <label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Find filenames</span><input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/files/find-files?query=${encodeURIComponent(event.target.value)}` }); }} placeholder="Find filenames" data-testid="file-search" /></label>
    <div className="file-browser-bar"><button type="button" className="text-button" disabled={!directory || Boolean(query)} onClick={() => { const next = directory.split('/').slice(0, -1).join('/'); setDirectory(next); setPreviewPath(''); setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/files/list?path=${encodeURIComponent(next)}` }); }} data-testid="files-up">Up</button><code>/{query ? 'search' : directory}</code><button type="button" className="icon-button small" onClick={() => setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/files/list?path=${encodeURIComponent(directory)} · /files/status` })} aria-label="Refresh files" data-testid="files-refresh"><Icon name="refresh" size={14} /></button></div>
    <div className="file-list" aria-label={query ? 'Filename matches' : `Contents of /${directory}`}>
      {directories.map((name) => <button type="button" onClick={() => openDirectory(name)} key={name} data-testid={`file-dir-${slug(prefix + name)}`}><Icon name="worktree" size={14} /><span>{name}</span><em>›</em></button>)}
      {visibleFiles.map((file) => <button type="button" className={file.path === previewPath ? 'selected' : ''} onClick={() => openFile(file)} key={file.path} data-testid={`file-${slug(file.path)}`}><Icon name="file" size={14} /><span>{query ? file.path : file.path.slice(prefix.length)}</span><em>{file.gitStatus ?? '-'}</em></button>)}
    </div>
    <div className="file-viewer"><header><code>{current?.path ?? `/${directory}`}</code>{current && <button type="button" onClick={() => notify('File path copied')} aria-label="Copy file path"><Icon name="copy" size={13} /></button>}</header>{renderPreview()}</div>
    <Trace trace={trace} />
  </section>;
}

// post-m1-phase-6 c2a/c2b: live Files panel — real find/list/content/status results, session-relative
// paths only (never absolute — apps/api_server/src/controllers/agent_sessions_controller.ts:2472-2479
// appends a `resolvedPath` that the gateway already strips before this component ever sees it).
function LiveFilesPanel() {
  const { selected, notify } = useFixtures();
  const gateway = useGateway();
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<SessionFileEntry[]>([]);
  const [statusEntries, setStatusEntries] = useState<SessionFileStatusEntry[]>([]);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState<SessionFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sessions = gateway.domains.sessions!;

  const refresh = () => {
    setError(''); setLoading(true);
    Promise.all([
      query.trim() ? sessions.findFiles(selected.id, query.trim(), { limit: 50, type: 'file' }) : Promise.resolve([] as string[]),
      sessions.listFiles(selected.id, directory),
      sessions.fileStatus(selected.id),
    ]).then(([found, listed, status]) => { setSearchResults(found); setEntries(listed); setStatusEntries(status); })
      .catch(() => setError('Files could not be loaded'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [selected.id]);

  const openFile = (path: string) => {
    setSelectedPath(path); setContent(null); setError('');
    sessions.fileContent(selected.id, path).then(setContent).catch(() => setError(`${path} could not be opened`));
  };

  const statusFor = (name: string) => statusEntries.find((entry) => entry.path === name || entry.path.endsWith(`/${name}`))?.status;
  const searching = query.trim().length > 0;

  return <section className="inspector-panel files-panel" aria-label="Session files" data-testid="files-panel">
    <label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Find filenames</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find filenames" data-testid="file-search" /></label>
    <div className="file-browser-bar"><code>/{searching ? 'search' : directory}</code><button type="button" className="icon-button small" onClick={refresh} aria-label="Refresh files" data-testid="files-refresh"><Icon name="refresh" size={14} /></button></div>
    {loading && <p className="inspector-state" aria-live="polite">Loading files…</p>}
    {error && <div className="file-guard" role="alert" data-testid="files-error">{error}</div>}
    <div className="file-list" aria-label={searching ? 'Filename matches' : `Contents of /${directory}`}>
      {searching && searchResults.map((path) => <button type="button" className={path === selectedPath ? 'selected' : ''} onClick={() => openFile(path)} key={path} data-testid={`file-${slug(path)}`}><Icon name="file" size={14} /><span>{path}</span><em>{statusFor(path) ?? '-'}</em></button>)}
      {searching && searchResults.length === 0 && !loading && <p className="rail-empty">No matching files.</p>}
      {!searching && entries.map((entry) => <button type="button" className={entry.name === selectedPath ? 'selected' : ''} onClick={() => openFile(directory ? `${directory}/${entry.name}` : entry.name)} key={entry.name} data-testid={`file-${slug(entry.name)}`}><Icon name={entry.type === 'directory' ? 'worktree' : 'file'} size={14} /><span>{entry.name}</span><em>{statusFor(entry.name) ?? '-'}</em></button>)}
      {!searching && entries.length === 0 && !loading && <p className="rail-empty">No files found.</p>}
    </div>
    <div className="file-viewer"><header><code>{selectedPath || `/${directory}`}</code>{selectedPath && <button type="button" onClick={() => notify('File path copied')} aria-label="Copy file path"><Icon name="copy" size={13} /></button>}</header>
      {!selectedPath && <div className="inspector-empty file-empty"><Icon name="file" size={22} /><h3>Select a file</h3><p>Text, image, and binary previews stay inside the session workspace.</p></div>}
      {selectedPath && !content && !error && <p className="inspector-state" aria-live="polite">Loading…</p>}
      {content && (content.type === 'binary'
        ? <div className="file-guard" role="status"><strong>Binary file</strong><p>{content.mimeType ?? 'application/octet-stream'}</p></div>
        : content.type === 'image'
          ? <div className="image-preview"><img src={`data:${content.mimeType ?? 'image/png'};base64,${content.content ?? ''}`} alt={`Preview of ${selectedPath}`} /></div>
          : <pre>{content.content || 'This file has no previewable content.'}</pre>)}
    </div>
  </section>;
}

// post-m1-phase-6 c2c-c3e: live Changes panel — session diff, VCS git/branch diff, raw-patch
// export, revert/restore, and worktree reset/remove, all against the real session boundary.
function LiveChangesPanel() {
  const { selected, notify } = useFixtures();
  const gateway = useGateway();
  const sessions = gateway.domains.sessions!;
  const [scope, setScope] = useState<'session' | 'git' | 'branch'>('session');
  const [sessionEntries, setSessionEntries] = useState<{ path: string; additions: number; deletions: number; patch?: string }[]>([]);
  const [vcsEntries, setVcsEntries] = useState<{ path: string; additions: number; deletions: number; patch?: string }[]>([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'remove' | 'revert' | 'restore' | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const firstUserMessage = selected.messages.find((message) => message.role === 'user');

  const loadSessionDiff = () => {
    setError('');
    sessions.sessionDiff(selected.id)
      .then((rows) => setSessionEntries(rows.map((row) => ({ path: row.file, additions: row.additions, deletions: row.deletions }))))
      .catch(() => setError('Diff could not be loaded'));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadSessionDiff, [selected.id]);

  const loadVcs = (mode: 'git' | 'branch') => {
    setError('');
    sessions.vcsDiff(selected.id, mode)
      .then((rows) => setVcsEntries(rows.map((row) => ({ path: row.file, additions: row.additions, deletions: row.deletions, patch: row.patch }))))
      .catch(() => setError('Diff could not be loaded'));
  };
  const setDiffScope = (next: 'session' | 'git' | 'branch') => {
    setScope(next);
    if (next === 'session') loadSessionDiff(); else loadVcs(next);
  };

  const exportPatch = () => {
    sessions.vcsDiffRaw(selected.id).then((patch) => {
      // c2e: hand the exact raw patch bytes to the host as a download — never re-encoded
      // through a display/trace string.
      const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-diff' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'session.patch'; link.click();
      URL.revokeObjectURL(url);
      notify('Patch exported as session.patch');
    }).catch(() => notify('Patch could not be exported'));
  };

  const confirmAction = () => {
    const action = confirm; setConfirm(null); setError('');
    // c3d/c3e: the server's bounded 502 (WORKTREE_RESET_FAILED/WORKTREE_REMOVE_FAILED) — or any
    // other gateway failure — surfaces as a retained, bounded error rather than a false success.
    const boundedError = (fallback: string) => (err: unknown) => setError(err instanceof SessionGatewayError ? err.message : fallback);
    if (action === 'reset') sessions.resetWorktree(selected.id).then(() => notify('Worktree changes reset')).catch(boundedError('Worktree reset failed'));
    if (action === 'remove') sessions.removeWorktreeSession(selected.id).then(() => notify('Worktree removed')).catch(boundedError('Worktree removal failed'));
    if (action === 'revert' && firstUserMessage) sessions.revert(selected.id, firstUserMessage.id).then(() => { notify('History reverted'); loadSessionDiff(); }).catch(boundedError('Revert failed'));
    if (action === 'restore') sessions.unrevert(selected.id).then(() => { notify('Reverted history restored'); loadSessionDiff(); }).catch(boundedError('Restore failed'));
  };

  const entries = scope === 'session' ? sessionEntries : vcsEntries;
  const canRevert = scope === 'session' && Boolean(firstUserMessage) && !selected.revertedMessageId;
  const canRestore = scope === 'session' && Boolean(selected.revertedMessageId);

  return <section className="inspector-panel changes-panel" aria-label="Session changes" data-testid="changes-panel">
    <div className="changes-summary"><span><strong>{entries.length}</strong> changed files</span><small>{scope === 'session' ? 'This session' : scope === 'git' ? 'All uncommitted' : 'vs default branch'}</small></div>
    <div className="segmented-control changes-scopes" role="group" aria-label="Changes scope">
      <button type="button" aria-pressed={scope === 'session'} onClick={() => setDiffScope('session')} data-testid="changes-scope-session">This session</button>
      <button type="button" aria-pressed={scope === 'git'} onClick={() => setDiffScope('git')} data-testid="changes-scope-git">All uncommitted</button>
      <button type="button" aria-pressed={scope === 'branch'} onClick={() => setDiffScope('branch')} data-testid="changes-scope-branch">vs default branch</button>
    </div>
    {error && <div className="file-guard" role="alert" data-testid="changes-error">{error}</div>}
    <div className="change-file-list">
      {entries.map((entry) => <article key={entry.path} className="change-file">
        <button type="button" aria-expanded={Boolean(expanded[entry.path])} onClick={() => setExpanded((current) => ({ ...current, [entry.path]: !current[entry.path] }))} data-testid={`change-file-${slug(entry.path)}`}>
          <Icon name="chevronRight" size={13} /><code>{entry.path}</code><span>+{entry.additions} −{entry.deletions}</span>
        </button>
        {expanded[entry.path] && entry.patch && <pre className="diff-code">{entry.patch}</pre>}
      </article>)}
      {entries.length === 0 && <p className="rail-empty">No changes.</p>}
    </div>
    <div className="inspector-actions changes-actions">
      <button className="secondary-button" type="button" onClick={exportPatch} data-testid="changes-export">Export patch</button>
      {canRestore ? <button className="secondary-button" type="button" onClick={() => setConfirm('restore')} data-testid="changes-restore">Restore</button> : <button className="secondary-button" type="button" disabled={!canRevert} title={!firstUserMessage ? 'No user message is available to revert to' : scope !== 'session' ? 'Revert is available for This session only' : undefined} onClick={() => setConfirm('revert')} data-testid="changes-revert">Revert</button>}
    </div>
    <div className="inspector-actions worktree-actions">
      <button className="secondary-button" type="button" disabled={!selected.isolateWorktree} onClick={() => setConfirm('reset')} data-testid="worktree-reset">Reset changes</button>
      <button className="text-danger-button" type="button" disabled={!selected.isolateWorktree || selected.status !== 'closed'} title={selected.status !== 'closed' ? 'Close the session before removing its worktree' : undefined} onClick={() => setConfirm('remove')} data-testid="worktree-remove">Remove worktree</button>
    </div>
    <FocusDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'reset' ? 'Reset worktree?' : confirm === 'remove' ? 'Remove worktree?' : confirm === 'restore' ? 'Restore reverted history?' : 'Revert to the first user message?'} description="This changes the live workspace only." testId="worktree-confirm-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(null)}>Cancel</button><button className="danger-button" type="button" onClick={confirmAction} data-testid="worktree-confirm">Confirm</button></div></FocusDialog>
  </section>;
}

function artifactDocument(html: string | undefined) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:22px;background:#eef7f3;color:#16312f;font:14px system-ui,sans-serif}main{max-width:620px}h1{font-size:22px}p{line-height:1.55}</style></head><body>${html ?? '<main><h1>Artifact unavailable</h1></main>'}</body></html>`;
}

function ArtifactsPanel({ trace, setTrace }: { trace: InspectorTrace | null; setTrace(trace: InspectorTrace): void }) {
  const { selected, notify } = useFixtures();
  const [artifactId, setArtifactId] = useState('');
  const [history, setHistory] = useState<'error' | 'loaded'>('error');
  const artifact = selected.artifacts.find((item) => item.id === artifactId) ?? selected.artifacts[0];
  if (!selected.artifacts.length) return <section className="inspector-panel artifacts-panel" aria-label="Session artifacts" data-testid="artifacts-panel"><div className="inspector-empty"><Icon name="artifact" size={24} /><h3>No artifacts yet</h3><p>Completed session output appears here and on Dashboard.</p></div><button className="text-button" type="button" onClick={() => navigate('/dashboard')} data-testid="artifacts-dashboard-link">Open Dashboard <Icon name="chevronRight" size={13} /></button></section>;
  return <section className="inspector-panel artifacts-panel" aria-label="Session artifacts" data-testid="artifacts-panel">
    <label className="field">Session artifact<select value={artifact?.id ?? ''} onChange={(event) => { setArtifactId(event.target.value); setTrace({ method: 'GET', route: `/live-artifacts/${event.target.value}` }); }} data-testid="artifact-selector">{selected.artifacts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <div className="artifact-meta"><span><strong>{artifact?.type}</strong><small>{artifact?.updatedAt?.replace('T', ' · ').slice(0, 18)}</small></span><button className="secondary-button" type="button" onClick={() => { notify(`${artifact?.name} opened`); setTrace({ method: 'GET', route: `/live-artifacts/${artifact?.id}` }); }} data-testid={`open-${artifact?.id}`}>Open</button></div>
    <div className="artifact-preview"><iframe title={`Preview of ${artifact?.name}`} sandbox="" srcDoc={artifactDocument(artifact?.html)} data-testid="artifact-preview" /></div>
    {history === 'error' ? <div className="artifact-history-error" role="status"><span><strong>Earlier history unavailable</strong><small>The first fixture page could not be read.</small></span><button className="secondary-button" type="button" onClick={() => { setHistory('loaded'); setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/messages?before=msg-user-handoff` }); }} data-testid="artifact-history-retry">Retry</button></div> : <p className="artifact-history-status" role="status">Earlier history loaded · {selected.artifacts.length} unique artifacts</p>}
    <button className="text-button" type="button" onClick={() => navigate('/dashboard')} data-testid="artifacts-dashboard-link">Open Dashboard <Icon name="chevronRight" size={13} /></button>
    <Trace trace={trace} />
  </section>;
}

export function Inspector({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const { inspectorTab, setInspectorTab, todos, selected, sessionGatewayMode } = useFixtures();
  const [trace, setTrace] = useState<InspectorTrace | null>(null);
  const [ptySessions, setPtySessions] = useState<Record<string, PtyFixture>>({});
  const [collapsedTodos, setCollapsedTodos] = useState<Record<string, boolean>>({});
  const expandControl = useRef<HTMLButtonElement>(null);
  const collapseControl = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(collapsed);
  useEffect(() => {
    if (previousCollapsed.current === collapsed) return;
    previousCollapsed.current = collapsed;
    requestAnimationFrame(() => (collapsed ? expandControl : collapseControl).current?.focus());
  }, [collapsed]);
  if (collapsed) return <aside className="inspector collapsed" aria-label="Inspector collapsed" data-testid="inspector-collapsed" data-od-id="session-inspector"><button ref={expandControl} className="icon-button collapse-control" type="button" onClick={onToggle} aria-label="Expand Inspector" data-testid="inspector-expand"><Icon name="expand" /></button>{tabs.map((tab) => <button className={`rail-glyph ${inspectorTab === tab.id ? 'selected' : ''}`} type="button" key={tab.id} onClick={() => { setInspectorTab(tab.id); onToggle(); }} aria-label={tab.label} data-testid={`inspector-collapsed-${tab.id}`}><Icon name={tab.icon} /></button>)}</aside>;
  const pty = ptySessions[selected.id] ?? { id: `pty-${selected.id}`, status: 'connected' as const, output: ['$ pwd', selected.cwd] };
  const updatePty = (next: PtyFixture) => setPtySessions((current) => ({ ...current, [selected.id]: next }));
  const live = sessionGatewayMode === 'live';
  const panel = inspectorTab === 'context' ? <ContextPanel /> : inspectorTab === 'changes' ? (live ? <LiveChangesPanel /> : <ChangesPanel trace={trace} setTrace={setTrace} />) : inspectorTab === 'terminal' ? <TerminalPanel pty={pty} updatePty={updatePty} trace={trace} setTrace={setTrace} /> : inspectorTab === 'files' ? (live ? <LiveFilesPanel /> : <FilesPanel trace={trace} setTrace={setTrace} />) : <ArtifactsPanel trace={trace} setTrace={setTrace} />;
  const moveTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(tabs.findIndex((tab) => tab.id === inspectorTab) + offset + tabs.length) % tabs.length].id;
    setInspectorTab(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="inspector-${next}"]`)?.focus());
  };
  const todosCollapsed = Boolean(collapsedTodos[selected.id]);
  return <aside className="inspector" aria-label="Session inspector" data-od-id="session-inspector"><header className="inspector-header"><div role="tablist" aria-label="Inspector views" onKeyDown={moveTab}>{tabs.map((tab) => <button role="tab" aria-selected={inspectorTab === tab.id} tabIndex={inspectorTab === tab.id ? 0 : -1} type="button" key={tab.id} onClick={() => { setInspectorTab(tab.id); setTrace(null); }} data-testid={`inspector-${tab.id}`}><Icon name={tab.icon} size={15} /><span>{tab.label}</span></button>)}</div><button ref={collapseControl} className="icon-button small" type="button" onClick={onToggle} aria-label="Collapse Inspector" data-testid="inspector-collapse"><Icon name="collapse" size={16} /></button></header><div className="inspector-content" role="region" aria-label={`${tabs.find((tab) => tab.id === inspectorTab)?.label ?? 'Session'} inspector content`} tabIndex={0} data-testid="inspector-content">{panel}</div><footer className={`todo-footer ${todosCollapsed ? 'collapsed' : ''}`}><button className="todo-title" type="button" onClick={() => setCollapsedTodos((current) => ({ ...current, [selected.id]: !current[selected.id] }))} aria-expanded={!todosCollapsed} data-testid="todo-toggle"><span><Icon name="todo" size={15} /><strong>Session plan</strong></span><small>{todos.filter((todo) => todo.done).length}/{todos.length}</small></button>{!todosCollapsed && <div>{todos.map((todo) => <label key={todo.id}><input type="checkbox" checked={todo.done} disabled readOnly data-testid={`todo-${todo.id}`} /><span>{todo.label}</span></label>)}</div>}</footer></aside>;
}
