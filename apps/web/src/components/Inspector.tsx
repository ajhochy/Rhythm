import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useGateway } from '../gateway/context';
import { useAuthUser } from '../gateway/auth';
import { InspectorGatewayError, readOnlyResourceDocument, sessionResources, type InspectorTodo, type MemoryProvenance, type ModelProvenance, type PreparedShare, type SessionResource, type TranscriptShare } from '../gateway/inspector';
import { SessionGatewayError, type RichTranscriptMessage, type SessionFileContent, type SessionFileEntry, type SessionFileStatusEntry } from '../gateway/sessions';
import { useFixtures } from '../store';
import type { FixtureFile, InspectorTab, Session } from '../types';
import { FocusDialog } from './FocusDialog';
import { navigate } from './Shell';
import { Timestamp } from './Timestamp';
import { UsageBudgetPanel } from './UsageBudgetPanel';
import { Terminal } from '@xterm/xterm';
import type { PtyGateway } from '../gateway/pty';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

const tabs: { id: InspectorTab; label: string; icon: 'activity' | 'diff' | 'terminal' | 'file' | 'artifact' }[] = [
  { id: 'context', label: 'Context', icon: 'activity' }, { id: 'changes', label: 'Changes', icon: 'diff' }, { id: 'terminal', label: 'Terminal', icon: 'terminal' }, { id: 'files', label: 'Files', icon: 'file' }, { id: 'artifacts', label: 'Artifacts', icon: 'artifact' },
];

type InspectorTrace = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'WS'; route: string };
type PtyFixture = { id: string; status: 'connecting' | 'connected' | 'exited' | 'error'; output: string[] };
const transcriptSharesChanged = 'rhythm-transcript-shares-changed';

function Trace({ trace }: { trace: InspectorTrace | null }) {
  if (!trace) return null;
  return <output className="inspector-trace" data-testid="inspector-trace"><strong>{trace.method}</strong> {trace.route}</output>;
}

function RunFeedback({ sessionId, hidden }: { sessionId: string; hidden: boolean }) {
  const gateway = useGateway();
  const requestSequence = useRef(0); const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId;
  const [verdict, setVerdict] = useState<'success' | 'partial' | 'failure' | null>(null); const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const load = async (targetSessionId: string, preserveError = false) => { const sequence = ++requestSequence.current; setLoading(true); if (!preserveError) setError(''); try { const outcome = await gateway.domains.runOutcomes!.get(targetSessionId); if (sequence !== requestSequence.current || targetSessionId !== sessionIdRef.current) return; setExists(Boolean(outcome)); setVerdict(outcome?.explicitUserVerdict ?? null); } catch (err) { if (sequence !== requestSequence.current || targetSessionId !== sessionIdRef.current) return; setExists(false); setVerdict(null); setError(err instanceof Error ? err.message : 'Run feedback could not be loaded'); } finally { if (sequence === requestSequence.current && targetSessionId === sessionIdRef.current) setLoading(false); } };
  useEffect(() => { requestSequence.current += 1; setSubmitting(false); setExists(false); setVerdict(null); if (hidden || gateway.mode !== 'live' || !gateway.domains.runOutcomes) { setLoading(false); setError(''); return; } void load(sessionId); return () => { requestSequence.current += 1; }; }, [sessionId, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden || gateway.mode !== 'live' || loading && !error || !exists && !error) return null;
  const submit = async (next: 'success' | 'partial' | 'failure') => { const targetSessionId = sessionId; setSubmitting(true); setError(''); try { await gateway.domains.runOutcomes!.feedback(targetSessionId, next); if (targetSessionId === sessionIdRef.current) await load(targetSessionId); } catch (err) { if (targetSessionId === sessionIdRef.current) { setError(err instanceof Error ? err.message : 'Run feedback could not be saved'); await load(targetSessionId, true); } } finally { if (targetSessionId === sessionIdRef.current) setSubmitting(false); } };
  return <section className="run-feedback" aria-label="Run feedback" data-testid="run-feedback"><header><h3>Run feedback</h3><button className="icon-button small" type="button" aria-label="Refresh run feedback" onClick={() => void load(sessionId)} data-testid="run-feedback-refresh"><Icon name="refresh" size={13} /></button></header>{error && <p role="alert">{error} <button className="text-button" type="button" onClick={() => void load(sessionId)}>Retry</button></p>}{exists && <div role="group" aria-label="How did this run go?">{(['success', 'partial', 'failure'] as const).map((item) => <button className={verdict === item ? 'selected' : ''} type="button" disabled={submitting} aria-pressed={verdict === item} onClick={() => void submit(item)} data-testid={`run-feedback-${item}`} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>}</section>;
}

function ContextPanel() {
  const { selected, models, sessionGatewayMode } = useFixtures();
  const persistedUsage = [...selected.messages].reverse().map((message) => message as RichTranscriptMessage).find((message) => {
    const tokens = message.tokens;
    return (tokens?.input ?? 0) + (tokens?.cache?.read ?? 0) + (tokens?.cache?.write ?? 0) > 0;
  });
  const liveTotal = (persistedUsage?.tokens?.input ?? 0) + (persistedUsage?.tokens?.cache?.read ?? 0) + (persistedUsage?.tokens?.cache?.write ?? 0);
  const catalogBudget = models.find((model) => model.providerId === selected.providerId && model.modelId === selected.modelId)?.contextLimit;
  const total = sessionGatewayMode === 'live' ? liveTotal : selected.inputTokens + selected.outputTokens + selected.cachedTokens;
  const budget = sessionGatewayMode === 'live' ? catalogBudget ?? 200_000 : selected.totalBudget;
  const pct = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
  const tokenLabel = (value: number) => value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}k` : String(value);
  return <section className="inspector-panel" aria-label="Session context" data-testid="context-panel">
    <div className="context-path"><Icon name="worktree" /><div><strong>{selected.cwd}</strong><small>{selected.isolateWorktree ? 'Isolated worktree' : 'Project workspace'} · {selected.dirtyCount} changed</small></div></div>
    {sessionGatewayMode === 'live' && !persistedUsage ? <div className="token-gauge token-gauge-empty" data-testid="context-usage-empty"><div><strong>Usage unavailable</strong><small>No persisted context usage yet</small></div></div> : <div className="token-gauge" aria-label={`${pct}% of context budget used`}><div><strong data-testid="context-usage-value">{tokenLabel(total)} / {tokenLabel(budget)}</strong><small>tokens</small></div><span><i style={{ width: `${pct}%` }} /></span><em data-testid="context-usage-percent">{pct}%</em></div>}
    <UsageBudgetPanel />
    <dl className="property-list"><div><dt>Created</dt><dd><Timestamp value={selected.createdAt} /></dd></div><div><dt>Updated</dt><dd><Timestamp value={selected.updatedAt} /></dd></div>
      {/* post-m1-phase-6 c3b: the resolved isolated-worktree branch — never defaulted to 'main'. */}
      {selected.worktreeBranch && <div><dt>Worktree branch</dt><dd>{selected.worktreeBranch}</dd></div>}
    </dl>
    {sessionGatewayMode === 'live' ? <><LiveProvenance sessionId={selected.id} /><LiveModelProvenance sessionId={selected.id} /><SharePanel sessionId={selected.id} /></> : <div className="memory-provenance"><h3>Memory provenance</h3><p>Project memory · services/run-sheet.md</p><p>Session summary · fixed fixture clock</p><p>Profile prompt · {selected.profileId}</p></div>}
    <RunFeedback sessionId={selected.id} hidden={sessionGatewayMode !== 'live' || Boolean(selected.parentSessionId)} />
  </section>;
}

function LiveProvenance({ sessionId }: { sessionId: string }) {
  const api = useGateway().domains.inspector;
  const [data, setData] = useState<MemoryProvenance | null>(null);
  const [error, setError] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => { let active = true; setError(false); setData(null);
    api?.provenance(sessionId).then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [api, sessionId, revision]);
  return <section className="memory-provenance"><h3>Memory provenance</h3>
    {!api || error ? <p role="alert">Memory provenance unavailable.</p> : !data ? <p role="status">Loading provenance…</p> : !data.recorded ? <p>No provenance recorded yet.</p> : <>
      {data.memoryIds.length === 0 && <p>No memories used in the latest turn.</p>}
      {data.memoryIds.map(id => <p key={id}>Memory · {id}</p>)}
      {data.notePaths.map(path => <p key={path}>{path}</p>)}
      {data.items.length > 0 && <details><summary>Injection details</summary><pre>{JSON.stringify(data.items, null, 2)}</pre></details>}
    </>}
    <button type="button" className="text-button" onClick={() => refresh(value => value + 1)}>Refresh provenance</button>
  </section>;
}

/**
 * #1576 S4 — "Served by": the model(s) that actually served this session's
 * steps, as distinct from the requested alias. The engine does not stamp
 * served identity yet (fork slice S1, not built), so most live sessions today
 * show the "not recorded" state below — that is the honest, expected result,
 * never a fabricated model name.
 */
export function LiveModelProvenance({ sessionId }: { sessionId: string }) {
  const api = useGateway().domains.inspector;
  const [data, setData] = useState<ModelProvenance | null>(null);
  const [error, setError] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => { let active = true; setError(false); setData(null);
    api?.modelProvenance(sessionId).then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [api, sessionId, revision]);
  return <section className="memory-provenance" aria-label="Model provenance" data-testid="model-provenance">
    <h3>Served by</h3>
    {!api || error ? <p role="alert">Served-model provenance unavailable.</p> : !data ? <p role="status">Loading served models…</p> : !data.available ? (
      // #1576 review follow-up: the hosted/Postgres role has no local ledger to
      // read — a known, labeled gap, not an error, so no alert role here.
      <p role="status">Provenance unavailable on this server.</p>
    ) : data.servedModels.length === 0 ? (
      // ponytail: never invent a model name — "unattributed" steps are steps the
      // engine ran before/without a served-identity stamp, not steps with no model.
      <>
        <p>{data.steps.unattributed > 0 ? `Not recorded (${data.steps.unattributed} steps before provenance capture)` : 'No served steps recorded yet.'}</p>
        {data.requestedModelId && <p data-testid="model-provenance-requested">Requested {data.requestedModelId} — unverified</p>}
      </>
    ) : <>
      <ul>{data.servedModels.map(model => <li key={model}>{model}</li>)}</ul>
      {data.multiModel && <p role="status">Spanned {data.servedModels.length} models</p>}
      {data.routed && <span className="kind-badge" data-testid="model-provenance-routed">Routed</span>}
    </>}
    <button type="button" className="text-button" onClick={() => refresh(value => value + 1)}>Refresh served models</button>
  </section>;
}

function LiveTodos({ sessionId }: { sessionId: string }) {
  const api = useGateway().domains.inspector;
  const [todos, setTodos] = useState<InspectorTodo[] | null>(null);
  const [error, setError] = useState(false); const [collapsed, setCollapsed] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => { let active = true; setError(false); setTodos(null);
    api?.todos(sessionId).then(value => { if (active) setTodos(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [api, sessionId, revision]);
  return <footer className={`todo-footer ${collapsed ? 'collapsed' : ''}`}>
    <button className="todo-title" type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><strong>Session plan</strong><small>{todos ? `${todos.filter(todo => todo.status === 'completed').length}/${todos.length}` : '—'}</small></button>
    {!collapsed && <div>{!api || error ? <p role="alert">Session plan unavailable.</p> : !todos ? <p role="status">Loading plan…</p> : todos.length === 0 ? <p>No session plan yet.</p> : todos.map(todo => <label key={todo.id}><input type="checkbox" readOnly disabled checked={todo.status === 'completed'} /><span>{todo.content} · {todo.status} · {todo.priority}</span></label>)}
      <button className="text-button" type="button" onClick={() => refresh(value => value + 1)}>Refresh plan</button></div>}
  </footer>;
}

export function SharedWithMePanel() {
  const api = useGateway().domains.inspector; const actorId = useAuthUser()?.user.id;
  const [shares, setShares] = useState<TranscriptShare[]>([]); const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false); const [view, setView] = useState<TranscriptShare | null>(null);
  const refresh = async () => {
    if (!api || !actorId) { setShares([]); setLoading(false); return; }
    setLoading(true);
    try {
      const now = Date.now(); const values = await api.shares();
      setShares(values.filter(share => share.recipientUserIds.includes(actorId) && !share.revokedAt && new Date(share.expiresAt).getTime() > now));
    } catch { setShares([]); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void refresh(); const changed = () => void refresh();
    window.addEventListener(transcriptSharesChanged, changed);
    return () => window.removeEventListener(transcriptSharesChanged, changed);
  }, [api, actorId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (id: string) => {
    if (!api) return; setUnavailable(false); setView(null);
    try { setView(await api.share(id)); } catch { setUnavailable(true); }
  };
  return <section className="memory-provenance" aria-label="Shared with me" data-testid="shared-with-me"><header><h2>Shared with me</h2><button className="text-button" type="button" disabled={loading} onClick={() => void refresh()}>Refresh</button></header>
    <p>Recipient-visible immutable snapshots. Private source sessions stay private.</p>
    {loading ? <p role="status">Loading shared snapshots…</p> : shares.length === 0 ? <p>No active snapshots shared with you.</p> : shares.map(share => <article key={share.id} data-testid={`shared-with-me-${share.id}`}><strong>Shared snapshot (immutable)</strong><p>Private source session not shown · Expires <Timestamp value={share.expiresAt} /></p><button className="secondary-button" type="button" onClick={() => void open(share.id)}>Open shared snapshot</button></article>)}
    {unavailable && <p role="alert">Shared snapshot unavailable</p>}
    <FocusDialog open={Boolean(view)} title="Shared snapshot (immutable)" testId="shared-with-me-snapshot" onClose={() => setView(null)} wide><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(view?.snapshot, null, 2)}</pre><button type="button" onClick={() => setView(null)}>Close</button></FocusDialog>
  </section>;
}

function SharePanel({ sessionId }: { sessionId: string }) {
  const api = useGateway().domains.inspector; const actor = useAuthUser()?.user;
  const [prepared, setPrepared] = useState<PreparedShare | null>(null);
  const [members, setMembers] = useState<Array<{ userId: number; name: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [recipients, setRecipients] = useState<number[]>([]);
  const [expiryDays, setExpiryDays] = useState<7 | 30 | 90>(90); const [confirming, setConfirming] = useState(false);
  const [shares, setShares] = useState<TranscriptShare[]>([]); const [view, setView] = useState<TranscriptShare | null>(null);
  const [error, setError] = useState(''); const [listError, setListError] = useState(''); const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const refresh = async () => { if (!api) return; const [shareResult, directoryResult] = await Promise.allSettled([api.shares(), api.recipients()]); if (shareResult.status === 'fulfilled') { setShares(shareResult.value.filter(share => share.sourceSessionId === null || share.sourceSessionId === sessionId)); setListError(''); } else setListError('Share list unavailable.'); if (directoryResult.status === 'fulfilled') setMembers(directoryResult.value.filter(member => member.userId !== actor?.id)); };
  useEffect(() => { void refresh(); return () => { sequence.current += 1; }; }, [api, sessionId, actor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ponytail: a bare requestAnimationFrame here raced FocusDialog's own rAF-driven autofocus/containment
  // (flaky toBeFocused failures on error). useLayoutEffect runs after the busy-disabled DOM commit but
  // before any paint/rAF, so it always wins deterministically.
  useLayoutEffect(() => { if (confirming && error) confirmButton.current?.focus(); }, [error, confirming]);
  const review = async () => {
    if (!api || busy) return; const current = ++sequence.current;
    setBusy(true); setError(''); setPrepared(null); setRecipients([]); setConfirming(false); setExpiryDays(90);
    try {
      const data = await api.review(sessionId);
      if (current !== sequence.current) return;
      // /me/members cannot prove eligibility for an admin reviewing another owner's source.
      if (!actor || data.sourceOwnerUserId !== actor.id) throw new Error('owner-directory-unavailable');
      const values = await api.recipients();
      if (current !== sequence.current) return;
      setMembers(values.filter(member => member.userId !== actor.id));
      setPrepared(data); setSelectedIds(data.snapshot.items.map(item => item.id));
    } catch { if (current === sequence.current) setError('Share review unavailable. An authorized source-owner workspace directory is required.'); }
    finally { if (current === sequence.current) setBusy(false); }
  };
  const create = async () => {
    if (!api || !prepared || busy || !recipients.length) return;
    setBusy(true); setError('');
    try {
      await api.createShare(sessionId, { reviewHash: prepared.reviewHash,
        review: { items: prepared.inclusiveSnapshot.items.filter(item => selectedIds.includes(item.id)) },
        explicitlyIncludedItemIds: selectedIds.filter(id => !prepared.snapshot.items.some(item => item.id === id)), recipientUserIds: recipients,
        ...(expiryDays === 90 ? {} : { expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString() }) });
      setPrepared(null); setConfirming(false); await refresh();
    } catch (failure) {
      if (failure instanceof InspectorGatewayError && failure.status === 409) { setPrepared(null); setRecipients([]); setError('Transcript changed. Review again before sharing.'); }
      else { setError('Share creation unavailable. No success confirmed.'); }
    } finally { setBusy(false); }
  };
  const revoke = async (id: string) => { if (!api || busy) return; setBusy(true); setError(''); try { await api.revoke(id); await refresh(); window.dispatchEvent(new Event(transcriptSharesChanged)); } catch { setError('Share revoke unavailable.'); } finally { setBusy(false); } };
  const read = async (id: string) => { if (!api) return; setError(''); try { setView(await api.share(id)); } catch { setError('Shared snapshot unavailable.'); } };
  const defaultIncludedIds = new Set(prepared?.snapshot.items.map(item => item.id) ?? []);
  const excludedByDefault = prepared?.inclusiveSnapshot.items.filter(item => !defaultIncludedIds.has(item.id) && !selectedIds.includes(item.id)) ?? [];
  const explicitlyIncluded = prepared?.inclusiveSnapshot.items.filter(item => !defaultIncludedIds.has(item.id) && selectedIds.includes(item.id)) ?? [];
  const excludedCounts = [...excludedByDefault.reduce((counts, item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1), new Map<string, number>())];
  const memberName = (userId: number) => userId === actor?.id ? 'You' : members.find(member => member.userId === userId)?.name ?? 'Unavailable recipient';
  const closeReview = () => { if (!busy) { sequence.current += 1; setPrepared(null); setConfirming(false); } };
  return <section className="memory-provenance" aria-label="Transcript sharing"><h3>Transcript sharing</h3>
    <p>Immutable snapshot · named recipients only. Sensitive items are excluded unless explicitly included; secrets remain redacted.</p>
    <p><strong>Private source session</strong> stays private. A <strong>Shared snapshot (immutable)</strong> remains available until revoked or expired, even if the local session is deleted. Detached copies from all sessions appear here.</p>
    <button type="button" className="secondary-button" disabled={!api || busy} onClick={() => void review()}>Review transcript share</button>
    <button type="button" className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh shares</button>
    {error && <p role="alert">{error}</p>}{listError && <p role="alert">{listError}</p>}
    {shares.length === 0 && !listError && <p>No shared snapshots for this session.</p>}
    {shares.map(share => <article key={share.id} data-testid={`share-${share.id}`}><code>{share.id}</code><p><strong>Private source session</strong> → <strong>Shared snapshot (immutable)</strong></p><p>Recipients: {share.recipientUserIds.map(memberName).join(', ')} · Expires <Timestamp value={share.expiresAt} /></p>
      {share.revokedAt ? <p>Revoked</p> : new Date(share.expiresAt).getTime() <= Date.now() ? <p>Expired</p> : <><button type="button" onClick={() => void read(share.id)}>View snapshot</button>{share.ownerUserId === actor?.id && <button type="button" disabled={busy} onClick={() => void revoke(share.id)}>Revoke</button>}</>}
    </article>)}
    <FocusDialog open={Boolean(prepared) && !confirming} title="Share reviewed transcript" description="Only checked content below will be published. This preview is sanitized by the server." testId="transcript-share-review" onClose={closeReview} wide>
      {prepared && <><section aria-label="Excluded content summary"><h3>Excluded by default ({excludedByDefault.length})</h3>{excludedCounts.length === 0 ? <p>No sensitive items remain excluded.</p> : <ul>{excludedCounts.map(([category, count]) => <li key={category}>{category.replaceAll('_', ' ')}: {count}</li>)}</ul>}<p>Explicitly included: {explicitlyIncluded.length}</p></section><fieldset disabled={busy}><legend>Exact snapshot selection</legend>
        {prepared.inclusiveSnapshot.items.map(item => { const excluded = !defaultIncludedIds.has(item.id); const included = selectedIds.includes(item.id); return <div key={item.id} data-testid={`share-item-${item.id}`}><label><input type="checkbox" aria-label={`Include ${item.id}`} checked={included} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{item.id} · {item.category.replaceAll('_', ' ')}{excluded && <em> · {included ? 'Explicitly included' : 'Excluded by default'}</em>}</label><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.content, null, 2)}</pre></div>; })}
      </fieldset><fieldset disabled={busy}><legend>Named recipients</legend>{members.length === 0 && <p>No eligible recipients available.</p>}{members.map(member => <label key={member.userId}><input type="checkbox" checked={recipients.includes(member.userId)} onChange={event => setRecipients(ids => event.target.checked ? [...ids, member.userId] : ids.filter(id => id !== member.userId))} />{member.name}</label>)}</fieldset>
      <label className="field">Expires after<select aria-label="Expires after" value={expiryDays} onChange={event => setExpiryDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" type="button" disabled={busy || !recipients.length || !selectedIds.length} onClick={() => setConfirming(true)}>Create immutable share</button></>}
    </FocusDialog>
    <FocusDialog open={Boolean(prepared) && confirming} title="Confirm immutable share" description="Confirm the exact recipients, expiration, and content counts before publishing." testId="transcript-share-confirm" onClose={() => { if (!busy) setConfirming(false); }}>
      {prepared && <><dl className="property-list"><div><dt>Recipients</dt><dd>{recipients.map(memberName).join(', ')}</dd></div><div><dt>Expiration</dt><dd>{expiryDays} days</dd></div><div><dt>Content</dt><dd>{selectedIds.length} included · {prepared.inclusiveSnapshot.items.length - selectedIds.length} excluded</dd></div></dl>{error && <p role="alert">{error}</p>}<div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button ref={confirmButton} className="primary-button" type="button" disabled={busy} onClick={() => void create()}>Confirm and share</button></div></>}
    </FocusDialog>
    <FocusDialog open={Boolean(view)} title="Shared snapshot" testId="transcript-share-snapshot" onClose={() => setView(null)} wide><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(view?.snapshot, null, 2)}</pre><button type="button" onClick={() => setView(null)}>Close</button></FocusDialog>
  </section>;
}

function LiveResources({ sessionId }: { sessionId: string }) {
  const gateway = useGateway(); const api = gateway.domains.inspector;
  const [resources, setResources] = useState<SessionResource[]>([]); const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);
  const sequence = useRef(0);
  const load = async (before?: number) => {
    if (!api) return; setLoading(true); setError('');
    try { const page = await api.messages(sessionId, before); const found = sessionResources(page.messages);
      setResources(previous => [...new Map([...(before ? previous : []), ...found].map(resource => [`${resource.kind}:${resource.id}`, resource])).values()]);
      setCursor(page.pageInfo?.hasMore ? page.pageInfo.nextCursor : null);
    } catch { setError('Resource history unavailable. Retry to load this page.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [api, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (resource: SessionResource) => {
    const current = ++sequence.current; setPreview(null); setError('');
    try {
      let text: string; let title: string;
      if (resource.kind === 'mcp') {
        if (!api) throw new Error(); const result = await api.resource(sessionId, resource.id);
        if (!result.mimeType.startsWith('text/html') || typeof result.text !== 'string') throw new Error();
        text = result.text; title = `MCP resource ${resource.id}`;
      } else {
        const artifacts = gateway.domains.liveArtifacts; if (!artifacts) throw new Error();
        const item = await artifacts.get(resource.id); text = await artifacts.render(resource.id); title = item.title;
      }
      if (current === sequence.current) setPreview({ title, text: readOnlyResourceDocument(text) });
    } catch { if (current === sequence.current) setError('Resource unavailable. It may be forbidden, deleted, or no longer provided.'); }
  };
  return <section className="inspector-panel artifacts-panel" aria-label="Session artifacts" data-testid="artifacts-panel">
    <h3>Session resources</h3><p>Read-only previews. Interactive MCP actions are unavailable here.</p>
    <button className="text-button" type="button" disabled={loading} onClick={() => void load()}>Refresh resources</button>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading resource history…</p>}
    {!resources.length && !loading && !error && <p>No resources found in loaded history.</p>}
    {resources.map(resource => <button className="secondary-button" type="button" key={`${resource.kind}:${resource.id}`} onClick={() => void open(resource)}>Open {resource.kind === 'mcp' ? 'MCP resource' : 'artifact'} {resource.id}</button>)}
    {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)}>Load earlier resources</button>}
    {preview && <div className="artifact-preview"><iframe title={preview.title} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.text} /></div>}
    <button className="text-button" type="button" onClick={() => navigate('/dashboard')}>Open Dashboard</button>
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

function TerminalPanel({ pty, updatePty, trace, setTrace, live, terminals }: { pty: PtyFixture; updatePty(next: PtyFixture): void; trace: InspectorTrace | null; setTrace(trace: InspectorTrace): void; live: boolean; terminals: Map<string, LocalTerminal> }) {
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
  if (live) return <LocalTerminalPanel key={selected.id} sessionId={selected.id} terminals={terminals} />;
  return <section className="inspector-panel terminal-panel" aria-label="Session terminal" data-testid="terminal-panel">
    <header><span><span className={`status-dot ${pty.status === 'connected' ? 'working' : pty.status === 'connecting' ? 'retrying' : 'offline'}`} />PTY · {pty.status}</span><span className="kind-badge">Fixture</span></header>
    <pre aria-live="polite" data-testid="terminal-output">{pty.output.join('\n')}</pre>
    {pty.status === 'connected' && <><form onSubmit={(event) => { event.preventDefault(); runCommand(); }}><label><span aria-hidden="true">$</span><input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Terminal command" placeholder="Enter terminal command" data-testid="terminal-input" /></label><button className="primary-button" type="submit" data-testid="terminal-run">Run</button></form><div className="command-chips"><button type="button" onClick={() => setCommand('pwd')}>pwd</button><button type="button" onClick={() => setCommand('git status --short')}>git status</button><button type="button" onClick={() => setCommand('npm test')}>npm test</button><button type="button" onClick={() => setCommand('exit')}>exit</button></div></>}
    {pty.status === 'exited' && <div className="terminal-recovery"><p>[process exited]</p><button className="secondary-button" type="button" onClick={openTerminal} data-testid="terminal-new">New terminal</button></div>}
    {pty.status === 'error' && <div className="terminal-recovery"><p>Terminal connection failed.</p><button className="secondary-button" type="button" onClick={() => { updatePty({ ...pty, status: 'connected' }); setTrace({ method: 'WS', route: `/ws/pty/${pty.id}` }); }} data-testid="terminal-retry">Retry</button></div>}
    {pty.status === 'connecting' && <p className="inspector-state" aria-live="polite">Connecting to terminal…</p>}
    <Trace trace={trace} />
  </section>;
}

// Inspector owns these resources; tab/collapse/session navigation only detaches their DOM.
// ponytail: one bounded xterm scrollback per opened session; explicit Close releases it.
class LocalTerminal {
  readonly terminal = new Terminal({ fontSize: 13, fontFamily: 'monospace', scrollback: 2000, screenReaderMode: true, disableStdin: true, theme: { background: '#111318', foreground: '#e4e6eb' } });
  readonly mount = document.createElement('div');
  readonly listeners = new Set<() => void>();
  status: 'connecting' | 'connected' | 'exited' | 'error' | 'closed' = 'connecting';
  error = '';
  private id = '';
  private socket?: WebSocket;
  private disposed = false;
  private ready: Promise<void>;
  private resizeQueue = Promise.resolve();
  private lastSize = '';
  constructor(private gateway: PtyGateway, sessionId: string) {
    this.mount.className = 'terminal-mount';
    this.terminal.onData((data) => { if (this.status === 'connected' && this.socket?.readyState === WebSocket.OPEN) this.socket.send(data); });
    this.ready = this.start(sessionId);
  }
  private notify() { for (const listener of this.listeners) listener(); }
  private async start(sessionId: string) {
    try {
      this.id = await this.gateway.create(sessionId);
      if (this.disposed) return;
      const socket = this.socket = this.gateway.connect(this.id);
      socket.onmessage = (event) => {
        if (this.disposed || typeof event.data !== 'string') return;
        // First output proves the API proxy has attached the engine (upgrade alone does not).
        this.status = 'connected'; this.terminal.options.disableStdin = false;
        this.terminal.write(event.data); this.fit(); this.notify();
      };
      socket.onerror = () => { if (!this.disposed) { this.status = 'error'; this.error = 'Terminal connection failed'; this.notify(); } };
      socket.onclose = (event) => {
        if (this.disposed) return;
        this.status = event.code === 1000 || event.code === 1005 ? 'exited' : 'error';
        if (this.status === 'error') this.error = 'Terminal connection lost';
        this.terminal.options.disableStdin = true; this.notify();
      };
    } catch (error) {
      if (!this.disposed) { this.status = 'error'; this.error = error instanceof Error ? error.message : 'Terminal failed'; this.notify(); }
    }
  }
  attach(host: HTMLElement) {
    host.append(this.mount);
    if (!this.terminal.element) {
      this.terminal.open(this.mount);
      const probe = document.createElement('span'); probe.className = 'terminal-size-probe'; probe.textContent = 'W'; this.mount.append(probe);
    }
    this.fit(); this.terminal.focus();
  }
  fit = () => {
    if (this.disposed || !this.mount.isConnected) return;
    const bounds = this.mount.getBoundingClientRect();
    const cell = this.mount.querySelector('.terminal-size-probe')?.getBoundingClientRect();
    if (!cell?.width || !cell.height || !bounds.width || !bounds.height) return;
    const cols = Math.max(2, Math.min(500, Math.floor((bounds.width - 16) / cell.width)));
    const rows = Math.max(2, Math.min(200, Math.floor(bounds.height / Math.ceil(cell.height))));
    this.terminal.resize(cols, rows);
    const size = `${cols}:${rows}`;
    if (!this.id || this.status !== 'connected' || this.lastSize === size) return;
    this.lastSize = size;
    this.resizeQueue = this.resizeQueue.then(async () => { if (!this.disposed) await this.gateway.resize(this.id, cols, rows); }).catch((error) => {
      if (!this.disposed) { this.lastSize = ''; this.error = error instanceof Error ? error.message : 'Terminal resize failed'; this.notify(); }
    });
  };
  async close() {
    this.disposed = true;
    if (this.socket) { this.socket.onmessage = null; this.socket.onerror = null; this.socket.onclose = null; this.socket.close(); this.socket = undefined; }
    this.terminal.dispose(); this.mount.remove();
    await this.ready; await this.resizeQueue;
    if (this.id) { await this.gateway.remove(this.id); this.id = ''; }
    this.status = 'closed'; this.error = ''; this.notify();
  }
}

function LocalTerminalPanel({ sessionId, terminals }: { sessionId: string; terminals: Map<string, LocalTerminal> }) {
  const gateway = useGateway().domains.pty;
  const host = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (!gateway || !host.current) return;
    let resource = terminals.get(sessionId);
    if (!resource) { resource = new LocalTerminal(gateway, sessionId); terminals.set(sessionId, resource); }
    const refresh = () => redraw((value) => value + 1);
    resource.listeners.add(refresh);
    if (resource.status !== 'closed') resource.attach(host.current);
    const observer = new ResizeObserver(resource.fit); observer.observe(host.current);
    refresh();
    return () => { observer.disconnect(); resource.listeners.delete(refresh); resource.mount.remove(); };
  }, [gateway, sessionId, terminals, generation]);
  const resource = terminals.get(sessionId);
  const change = async (restart: boolean) => {
    setBusy(true); setActionError('');
    try {
      await resource?.close();
      if (restart) { terminals.delete(sessionId); setGeneration((value) => value + 1); }
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Terminal cleanup failed'); }
    finally { setBusy(false); }
  };
  if (!gateway) return <section className="inspector-panel" role="status">Local terminal unavailable.</section>;
  const status = resource?.status ?? 'connecting';
  return <section className="inspector-panel terminal-panel local-pty" aria-label="Session terminal" data-testid="terminal-panel">
    <header><span role="status">Local PTY · {status}</span></header>
    {(actionError || resource?.error) && <p role="alert">{actionError || resource?.error}</p>}
    <div className="terminal-host" ref={host} data-testid="terminal-output" />
    <div className="terminal-controls">
      {(status === 'error' || actionError || resource?.error) && <button type="button" className="secondary-button" disabled={busy} onClick={() => void change(true)} data-testid="terminal-retry">Retry</button>}
      {(status === 'exited' || status === 'closed') && <button type="button" className="secondary-button" disabled={busy} onClick={() => void change(true)} data-testid="terminal-new">New terminal</button>}
      {status !== 'closed' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void change(false)} data-testid="terminal-close">Close terminal</button>}
    </div>
  </section>;
}

const slug = (value: string) => value.replace(/[^a-z0-9]/gi, '-');

async function copyFilePath(path: string, notify: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(path);
    notify('File path copied');
  } catch {
    notify('File path copy failed');
  }
}

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
    <div className="file-viewer"><header><code>{current?.path ?? `/${directory}`}</code>{current && <button type="button" onClick={() => void copyFilePath(current.path, notify)} aria-label="Copy file path"><Icon name="copy" size={13} /></button>}</header>{renderPreview()}</div>
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
    <div className="file-viewer"><header><code>{selectedPath || `/${directory}`}</code>{selectedPath && <button type="button" onClick={() => void copyFilePath(selectedPath, notify)} aria-label="Copy file path"><Icon name="copy" size={13} /></button>}</header>
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
  const { selected, notify, revertSession, unrevertSession } = useFixtures();
  const gateway = useGateway();
  const sessions = gateway.domains.sessions!;
  const [scope, setScope] = useState<'session' | 'git' | 'branch'>('session');
  const [sessionEntries, setSessionEntries] = useState<{ path: string; additions: number; deletions: number; patch?: string; before?: string; after?: string }[]>([]);
  const [vcsEntries, setVcsEntries] = useState<{ path: string; additions: number; deletions: number; patch?: string; before?: string; after?: string }[]>([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'remove' | 'revert' | 'restore' | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const firstUserMessage = selected.messages.find((message) => message.role === 'user');

  const loadSessionDiff = () => {
    setError('');
    sessions.sessionDiff(selected.id)
      .then((rows) => setSessionEntries(rows.map((row) => ({ path: row.file, additions: row.additions, deletions: row.deletions, before: row.before, after: row.after }))))
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
    if (action === 'revert' && firstUserMessage) void revertSession(selected.id, firstUserMessage.id).then(ok => { if (ok) loadSessionDiff(); else setError('Revert failed; see session operation error'); });
    if (action === 'restore') void unrevertSession(selected.id).then(ok => { if (ok) loadSessionDiff(); else setError('Restore failed; see session operation error'); });
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
        {expanded[entry.path] && (entry.patch !== undefined || entry.before !== undefined || entry.after !== undefined) && <pre className="diff-code">{entry.patch ?? `--- Before\n${entry.before ?? ''}\n+++ After\n${entry.after ?? ''}`}</pre>}
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
    <div className="artifact-meta"><span><strong>{artifact?.type}</strong><small><Timestamp value={artifact?.updatedAt} /></small></span><button className="secondary-button" type="button" onClick={() => { notify(`${artifact?.name} opened`); setTrace({ method: 'GET', route: `/live-artifacts/${artifact?.id}` }); }} data-testid={`open-${artifact?.id}`}>Open</button></div>
    <div className="artifact-preview"><iframe title={`Preview of ${artifact?.name}`} sandbox="" srcDoc={artifactDocument(artifact?.html)} data-testid="artifact-preview" /></div>
    {history === 'error' ? <div className="artifact-history-error" role="status"><span><strong>Earlier history unavailable</strong><small>The first fixture page could not be read.</small></span><button className="secondary-button" type="button" onClick={() => { setHistory('loaded'); setTrace({ method: 'GET', route: `/agent-sessions/${selected.id}/messages?before=msg-user-handoff` }); }} data-testid="artifact-history-retry">Retry</button></div> : <p className="artifact-history-status" role="status">Earlier history loaded · {selected.artifacts.length} unique artifacts</p>}
    <button className="text-button" type="button" onClick={() => navigate('/dashboard')} data-testid="artifacts-dashboard-link">Open Dashboard <Icon name="chevronRight" size={13} /></button>
    <Trace trace={trace} />
  </section>;
}

export function Inspector({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const { inspectorTab, setInspectorTab, todos, selected, sessionGatewayMode } = useFixtures();
  const actorId = useAuthUser()?.user.id;
  const identityKey = `${actorId ?? 'anonymous'}:${selected.id}`;
  const terminals = useRef(new Map<string, LocalTerminal>()).current;
  useEffect(() => () => { for (const terminal of terminals.values()) void terminal.close().catch((error) => console.warn('Terminal cleanup failed', error)); terminals.clear(); }, [terminals]);
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
  const panel = inspectorTab === 'context' ? <ContextPanel key={identityKey} /> : inspectorTab === 'changes' ? (live ? <LiveChangesPanel /> : <ChangesPanel trace={trace} setTrace={setTrace} />) : inspectorTab === 'terminal' ? <TerminalPanel pty={pty} updatePty={updatePty} trace={trace} setTrace={setTrace} live={live} terminals={terminals} /> : inspectorTab === 'files' ? (live ? <LiveFilesPanel /> : <FilesPanel trace={trace} setTrace={setTrace} />) : live ? <LiveResources key={identityKey} sessionId={selected.id} /> : <ArtifactsPanel trace={trace} setTrace={setTrace} />;
  const moveTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(tabs.findIndex((tab) => tab.id === inspectorTab) + offset + tabs.length) % tabs.length].id;
    setInspectorTab(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="inspector-${next}"]`)?.focus());
  };
  const todosCollapsed = Boolean(collapsedTodos[selected.id]);
  return <aside className="inspector" aria-label="Session inspector" data-od-id="session-inspector">
    <header className="inspector-header"><div role="tablist" aria-label="Inspector views" onKeyDown={moveTab}>{tabs.map((tab) => <button role="tab" aria-selected={inspectorTab === tab.id} tabIndex={inspectorTab === tab.id ? 0 : -1} type="button" key={tab.id} onClick={() => { setInspectorTab(tab.id); setTrace(null); }} data-testid={`inspector-${tab.id}`}><Icon name={tab.icon} size={15} /><span>{tab.label}</span></button>)}</div><button ref={collapseControl} className="icon-button small" type="button" onClick={onToggle} aria-label="Collapse Inspector" data-testid="inspector-collapse"><Icon name="collapse" size={16} /></button></header>
    {/* ponytail: gate mounting, not just requests, so every session panel drops stale state. */}
    <div className="inspector-content" role="region" aria-label={`${tabs.find((tab) => tab.id === inspectorTab)?.label ?? 'Session'} inspector content`} tabIndex={0} data-testid="inspector-content">{live && <SharedWithMePanel />}{selected.id ? panel : <p className="inspector-empty" role="status">Select a session to inspect its details.</p>}</div>
    {selected.id && (live ? <LiveTodos key={identityKey} sessionId={selected.id} /> : <footer className={`todo-footer ${todosCollapsed ? 'collapsed' : ''}`}><button className="todo-title" type="button" onClick={() => setCollapsedTodos((current) => ({ ...current, [selected.id]: !current[selected.id] }))} aria-expanded={!todosCollapsed} data-testid="todo-toggle"><span><Icon name="todo" size={15} /><strong>Session plan</strong></span><small>{todos.filter((todo) => todo.done).length}/{todos.length}</small></button>{!todosCollapsed && <div>{todos.map((todo) => <label key={todo.id}><input type="checkbox" checked={todo.done} disabled readOnly data-testid={`todo-${todo.id}`} /><span>{todo.label}</span></label>)}</div>}</footer>)}
  </aside>;
}
