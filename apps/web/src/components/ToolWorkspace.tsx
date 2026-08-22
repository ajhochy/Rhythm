import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { FIXED_NOW } from '../fixtures';
import { useGateway } from '../gateway/context';
import type { AgentMemory } from '../gateway/memory';
import type { OrgProposal } from '../gateway/org-proposals';
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRun } from '../gateway/schedules';
import type { AgentRunQuality } from '../gateway/run-quality';
import type { CommandEntry, ManagedCommandContent } from '../gateway/commands';
import type { CookbookRecipe } from '../gateway/cookbook';
import type { ResearchProject as LiveResearchProject, ResearchProjectRun } from '../gateway/research';
import type { AgentDesign } from '../gateway/designs';
import type { SkillEntry } from '../gateway/skills';
import type { Profile } from '../types';
import { Icon } from '../icons';
import { useFixtures } from '../store';
import { FocusDialog } from './FocusDialog';
import { profileAvatarLabel } from './Profiles';
import { navigate } from './Shell';

// Parses a JSON array field defensively — live rows always carry these as JSON text
// (see apps/api_server/src/repositories/agent_memory_repository.ts:9-30), never as
// already-parsed arrays, so a malformed or absent value must degrade to [] rather than throw.
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

type Trace = { method: string; route: string; detail: string };
type ToolSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type ToolStateCopy = { endpoint: string; emptyTitle: string; emptyDescription: string };

const toolStateCopy: Record<string, ToolStateCopy> = {
  brain: { endpoint: '/agent-memory', emptyTitle: 'No memories yet', emptyDescription: 'Verified facts, preferences, and decisions will appear here after an agent saves them.' },
  'deep-research': { endpoint: '/agent-research/projects', emptyTitle: 'No research projects yet', emptyDescription: 'Create a project to keep multi-pass evidence, sources, and discussion in one place.' },
  tasks: { endpoint: '/agent-schedules', emptyTitle: 'No schedules yet', emptyDescription: 'Create a schedule for recurring work or a one-time agent job.' },
  webhooks: { endpoint: '/agent-webhooks', emptyTitle: 'No webhook endpoints yet', emptyDescription: 'Create a private endpoint to turn trusted inbound events into agent work.' },
  skills: { endpoint: '/opencode/skills?withMetadata=true', emptyTitle: 'No managed skills found', emptyDescription: 'Create a managed skill or refresh after adding one to the engine.' },
  playbooks: { endpoint: '/opencode/commands', emptyTitle: 'No playbooks found', emptyDescription: 'Create a playbook to make a reusable slash command available in the composer.' },
  cookbook: { endpoint: '/agent-cookbook', emptyTitle: 'Your cookbook is empty', emptyDescription: 'Create a recipe to turn a proven sequence into a repeatable agent run.' },
  review: { endpoint: '/agent-org-proposals?status=proposed', emptyTitle: 'Nothing waiting for review', emptyDescription: 'New organization proposals will remain inert here until a person decides.' },
  'report-card': { endpoint: '/agents/run-quality?windowDays=30', emptyTitle: 'No scored runs yet', emptyDescription: 'Quality trends appear after an agent finishes a run with enough evidence to score.' },
  email: { endpoint: '/integrations/gmail-signals', emptyTitle: 'No Gmail signals', emptyDescription: 'New work signals will appear here when the connected mailbox identifies one.' },
  gallery: { endpoint: '/agent-designs', emptyTitle: 'No creative artifacts yet', emptyDescription: 'Generated images, documents, and interactive artifacts will collect here.' },
  'agent-settings': { endpoint: 'fixture://agent-settings', emptyTitle: 'No local defaults configured', emptyDescription: 'Runtime defaults will appear after this desktop has a local agent connection.' },
};

const toolStateLabels: Record<ToolSurfaceState, string> = {
  ready: 'Ready',
  loading: 'Loading',
  empty: 'First use / empty',
  'server-error': 'Server error · retryable',
  forbidden: 'Forbidden · 403',
  unavailable: 'Service unavailable',
  readonly: 'Read only',
};

function initialToolState(): ToolSurfaceState {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('state');
  return requested && Object.hasOwn(toolStateLabels, requested) ? requested as ToolSurfaceState : 'ready';
}

function ToolFrame({ slug, title, description, actions, trace, children }: { slug: string; title: string; description: string; actions?: ReactNode; trace: Trace; children: ReactNode }) {
  const copy = toolStateCopy[slug];
  const [surfaceState, setSurfaceState] = useState<ToolSurfaceState>(initialToolState);
  const [recoveryCount, setRecoveryCount] = useState(0);
  const isReady = surfaceState === 'ready';
  const isReadonly = surfaceState === 'readonly';
  const effectiveTrace = recoveryCount > 0
    ? { method: copy.endpoint.startsWith('fixture:') ? 'LOCAL' : 'GET', route: copy.endpoint, detail: `Recovered ${title} fixture on attempt ${recoveryCount}` }
    : trace;
  const chooseState = (next: ToolSurfaceState) => {
    setSurfaceState(next);
    const route = window.location.hash.split('?')[0] || `#/tools/${slug}`;
    history.replaceState(null, '', next === 'ready' ? route : `${route}?state=${next}`);
  };
  const recover = () => {
    setRecoveryCount((count) => count + 1);
    chooseState('ready');
  };
  const statePanel = surfaceState === 'loading'
    ? <section className="tool-state-panel loading" role="status" aria-live="polite" data-testid="tool-state-loading"><span className="tool-state-spinner" /><span className="eyebrow">Loading from {copy.endpoint}</span><h2>Loading {title}</h2><p>Your existing workspace stays intact while this Tool reconnects.</p><div className="tool-skeleton-lines" aria-hidden="true"><span /><span /><span /></div></section>
    : surfaceState === 'empty'
      ? <section className="tool-state-panel" data-testid="tool-state-empty"><span className="tool-state-mark"><Icon name="tools" size={22} /></span><span className="eyebrow">First use</span><h2>{copy.emptyTitle}</h2><p>{copy.emptyDescription}</p><button className="primary-button" type="button" onClick={recover} data-testid="tool-load-example">Load fixture example</button></section>
      : surfaceState === 'server-error'
        ? <section className="tool-state-panel error" role="alert" data-testid="tool-state-server-error"><span className="tool-state-code">503</span><span className="eyebrow">Retryable server error</span><h2>{title} could not be loaded</h2><p>The service returned a temporary error. Your local changes were not discarded.</p><code>{copy.endpoint}</code><button className="primary-button" type="button" onClick={recover} data-testid="tool-retry">Try again</button></section>
        : surfaceState === 'forbidden'
          ? <section className="tool-state-panel warning" role="alert" data-testid="tool-state-forbidden"><span className="tool-state-code">403</span><span className="eyebrow">Permission required</span><h2>You do not have access to {title}</h2><p>Ask a workspace administrator to grant access. This preview does not expose or mutate restricted data.</p><code>{copy.endpoint}</code></section>
          : surfaceState === 'unavailable'
            ? <section className="tool-state-panel warning" role="status" data-testid="tool-state-unavailable"><span className="tool-state-mark"><Icon name="activity" size={22} /></span><span className="eyebrow">Service unavailable</span><h2>{title} is offline</h2><p>The workspace remains readable, but this Tool needs its local service before work can continue.</p><code>{copy.endpoint}</code><button className="secondary-button" type="button" onClick={recover} data-testid="tool-check-again"><Icon name="refresh" size={14} />Check again</button></section>
            : null;
  return (
    <section className="tool-workspace" aria-labelledby="tool-title" data-testid={`tool-page-${slug}`} data-od-id={`tool-${slug}`}>
      <header className="tool-workspace-header">
        <div className="tool-heading-copy">
          <button className="text-button" type="button" onClick={() => navigate('/agents')} data-testid="tool-back"><Icon name="chevronRight" className="rotate-180" size={14} />Back to Agents</button>
          <span className="eyebrow">Agents tool</span>
          <h1 id="tool-title">{title}</h1>
          <p>{description}</p>
        </div>
        <div className="tool-heading-controls">
          <label className="tool-state-picker">View state<select value={surfaceState} onChange={(event) => chooseState(event.target.value as ToolSurfaceState)} data-testid="tool-state-select">{(Object.keys(toolStateLabels) as ToolSurfaceState[]).map((state) => <option key={state} value={state}>{toolStateLabels[state]}</option>)}</select></label>
          {actions && <fieldset className="tool-header-actions" disabled={!isReady} data-testid="tool-header-action-gate"><legend className="sr-only">{title} actions</legend>{actions}</fieldset>}
        </div>
      </header>
      <div className="tool-workspace-body" tabIndex={0} aria-busy={surfaceState === 'loading'} aria-label={`${title} workspace content`} data-testid="tool-workspace-content">
        {statePanel}
        {(isReady || isReadonly) && <>
          {isReadonly && <div className="tool-readonly-banner" role="status" data-testid="tool-state-readonly"><Icon name="review" size={15} /><span><strong>Read-only access</strong> You can inspect this Tool, but actions and edits are unavailable for this role.</span></div>}
          <fieldset className="tool-state-gate" disabled={isReadonly} data-testid="tool-content-action-gate"><legend className="sr-only">{isReadonly ? 'Read-only' : 'Interactive'} {title} content</legend>{children}</fieldset>
        </>}
      </div>
      <output className="tool-trace" aria-live="polite" data-testid="tool-trace"><span>Request</span><strong>{effectiveTrace.method}</strong><code>{effectiveTrace.route}</code><small>{effectiveTrace.detail}</small></output>
    </section>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="tool-empty"><Icon name="tools" size={26} /><h2>{title}</h2><p>{children}</p></div>;
}

function ConfirmDialog({ open, title, description, confirmLabel, onClose, onConfirm, testId }: { open: boolean; title: string; description: string; confirmLabel: string; onClose(): void; onConfirm(): void; testId: string }) {
  return <FocusDialog open={open} onClose={onClose} title={title} description={description} testId={testId}><div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="danger-button" type="button" onClick={onConfirm} data-testid={`${testId}-confirm`}>{confirmLabel}</button></div></FocusDialog>;
}

type Memory = { id: string; kind: string; content: string; tags: string[]; source: string; trust: string; generatedBy: string; expanded?: boolean };
const seedMemories: Memory[] = [
  { id: 'memory-handoff', kind: 'fact', content: 'Sunday handoffs must identify a livestream fallback owner before publishing.', tags: ['handoff', 'services'], source: 'services/handbook.md', trust: 'verified', generatedBy: 'session-sunday-handoff' },
  { id: 'memory-relay', kind: 'preference', content: 'When the desktop relay is offline, keep drafts local and state that they have not been sent.', tags: ['relay', 'offline'], source: 'agents/relay-notes.md', trust: 'reviewed', generatedBy: 'session-offline' },
];

function FixtureBrainTool() {
  const { notify } = useFixtures();
  const [memories, setMemories] = useState(seedMemories);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-memory', detail: 'Loaded deterministic memory entries' });
  const visible = memories.filter((item) => `${item.content} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const content = String(data.get('content')).trim(); if (!content) return;
    if (editing) { setMemories((current) => current.map((item) => item.id === editing.id ? { ...item, content, kind: String(data.get('kind')), tags: String(data.get('tags')).split(',').map((tag) => tag.trim()).filter(Boolean) } : item)); record('PATCH', `/agent-memory/${editing.id}`, 'Memory content, kind, and tags updated'); }
    setEditing(null);
  };
  return <ToolFrame slug="brain" title="Agent Memory" description="Search, inspect, and curate the persistent memories available to agent sessions." trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => record('GET', '/agent-memory', 'Memory list refreshed')} data-testid="brain-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    <div className="tool-filterbar"><label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search memories</span><input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) setTrace({ method: 'GET', route: `/agent-memory/search?q=${encodeURIComponent(event.target.value)}`, detail: 'Memory search is local in this fixture' }); }} placeholder="Search memories…" data-testid="brain-search" /></label><span>{visible.length} memories</span></div>
    <div className="tool-list" data-testid="brain-list">{visible.map((memory) => <article className="tool-row expandable" key={memory.id} data-testid={`memory-${memory.id}`}><button className="tool-row-main" type="button" aria-expanded={Boolean(memory.expanded)} onClick={() => setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, expanded: !item.expanded } : item))}><span className="kind-badge">{memory.kind}</span><span><strong>{memory.content}</strong><small>{memory.source} · {memory.trust} · {memory.tags.join(' · ')}</small></span><Icon name="chevronDown" className={memory.expanded ? 'rotate-180' : ''} size={14} /></button>{memory.expanded && <div className="tool-row-detail"><dl><div><dt>Generated by</dt><dd>{memory.generatedBy}</dd></div><div><dt>Scope</dt><dd>Agent workspace</dd></div><div><dt>Source metadata</dt><dd>{memory.source}</dd></div></dl><div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(memory)} data-testid={`brain-edit-${memory.id}`}><Icon name="rename" size={13} />Edit memory</button><button className="text-danger-button" type="button" onClick={() => setDeleting(memory)} data-testid={`brain-delete-${memory.id}`}><Icon name="delete" size={13} />Delete</button></div></div>}</article>)}</div>
    {visible.length === 0 && <EmptyState title="No memories found">Try a different phrase or clear the search.</EmptyState>}
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit memory" description="Update this memory entry and its metadata." testId="memory-editor"><form className="form-grid" onSubmit={save}><label className="field span-2">Content<textarea name="content" defaultValue={editing?.content ?? ''} data-autofocus rows={5} required /></label><label className="field">Kind<select name="kind" defaultValue={editing?.kind ?? 'fact'}><option>fact</option><option>preference</option><option>decision</option></select></label><label className="field">Tags<input name="tags" defaultValue={editing?.tags.join(', ') ?? ''} placeholder="handoff, services" /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="memory-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete memory?" description={deleting?.content || ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (!deleting) return; setMemories((current) => current.filter((item) => item.id !== deleting.id)); record('DELETE', `/agent-memory/${deleting.id}`, 'Memory permanently deleted'); setDeleting(null); }} testId="memory-delete-dialog" />
  </ToolFrame>;
}

// Live memory surface — apps/api_server/src/repositories/agent_memory_repository.ts:9-30 is the
// canonical row shape. `lifecycleState` and `trustTier` are rendered verbatim from the server;
// this must never fall back to the fixture's seeded 'verified'/'reviewed' display literals.
function LiveBrainTool() {
  const gateway = useGateway();
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-memory', detail: 'Loading live memories' });

  const load = async () => {
    setError(null);
    try {
      const next = await gateway.domains.memory!.list();
      setMemories(next);
      setTrace({ method: 'GET', route: '/agent-memory', detail: `${next.length} memories loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Memory list failed'); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (value: string) => {
    setQuery(value);
    setError(null);
    try {
      const next = value ? await gateway.domains.memory!.search(value) : await gateway.domains.memory!.list();
      setMemories(next);
      setTrace(value
        ? { method: 'GET', route: `/agent-memory/search?q=${encodeURIComponent(value)}`, detail: `${next.length} memories matched` }
        : { method: 'GET', route: '/agent-memory', detail: `${next.length} memories loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Memory search failed'); }
  };

  return <ToolFrame slug="brain" title="Agent Memory" description="Search, inspect, and curate the persistent memories available to agent sessions." trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="brain-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    <div className="tool-filterbar"><label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search memories</span><input value={query} onChange={(event) => void search(event.target.value)} placeholder="Search memories…" data-testid="brain-search" /></label><span>{memories.length} memories</span></div>
    {error && <section className="tool-state-panel error" role="alert" data-testid="brain-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    <div className="tool-list" data-testid="brain-list">{memories.map((memory) => {
      const sources = parseJsonArray<{ id?: string; title?: string }>(memory.sourcesJson);
      const verified = parseJsonArray<{ by?: string; at?: string }>(memory.verifiedJson);
      const tags = parseJsonArray<string>(memory.tagsJson);
      return <article className="tool-row" key={memory.id} data-testid={`memory-${memory.id}`}>
        <span className="kind-badge">{memory.kind}</span>
        <div>
          <strong>{memory.content}</strong>
          <small><span>{memory.lifecycleState ?? memory.status}</span> · <span>{memory.trustTier}</span>{tags.length > 0 ? ` · ${tags.join(' · ')}` : ''}</small>
          {sources.length > 0 && <p className="memory-meta">Sources: {sources.map((source) => source.title ?? source.id).filter(Boolean).join(', ')}</p>}
          {verified.length > 0 && <p className="memory-meta">Verified by {verified.map((entry) => `${entry.by ?? 'unknown'}${entry.at ? ` at ${entry.at}` : ''}`).join(', ')}</p>}
        </div>
      </article>;
    })}</div>
    {memories.length === 0 && !error && <EmptyState title="No memories found">Try a different phrase, or clear the search to reload the live list.</EmptyState>}
  </ToolFrame>;
}

type ResearchProject = { id: string; name: string; question: string; status: 'active' | 'archived'; run: { id: string; status: 'completed' | 'failed' | 'working'; synthesis: string } };
function ResearchTool() {
  const { notify } = useFixtures();
  const [projects, setProjects] = useState<ResearchProject[]>([
    { id: 'research-accessibility', name: 'Service accessibility', question: 'What should the Sunday service accessibility checklist cover?', status: 'active', run: { id: 'run-accessibility-03', status: 'completed', synthesis: 'Prioritize captioning, step-free navigation, sensory notes, and a named fallback owner.' } },
    { id: 'research-relay', name: 'Relay compatibility', question: 'Where does the relay recovery flow fail?', status: 'active', run: { id: 'run-relay-02', status: 'failed', synthesis: 'The last pass stopped before source synthesis.' } },
  ]);
  const [selectedId, setSelectedId] = useState(projects[0].id);
  const [projectDialog, setProjectDialog] = useState(false);
  const [legacyDialog, setLegacyDialog] = useState(false);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-research/projects', detail: 'Research projects loaded' });
  const selected = projects.find((item) => item.id === selectedId) ?? projects[0];
  const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  return <ToolFrame slug="deep-research" title="Research Projects" description="Run multi-pass research, inspect evidence, and keep discussion and export actions attached to a project run." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => setLegacyDialog(true)} data-testid="research-new-legacy">New Research</button><button className="primary-button" type="button" onClick={() => setProjectDialog(true)} data-testid="research-new-project"><Icon name="plus" size={14} />Create project</button></>}>
    <div className="tool-split research-layout"><aside className="tool-rail" aria-label="Research projects"><h2>Projects</h2>{projects.map((project) => <button className={project.id === selected.id ? 'selected' : ''} type="button" key={project.id} onClick={() => { setSelectedId(project.id); record('GET', `/agent-research/projects/${project.id}/runs`, 'Project runs loaded'); }} data-testid={`research-project-${project.id}`}><strong>{project.name}</strong><small>{project.status} · {project.run.status}</small></button>)}</aside><section className="tool-detail" aria-labelledby="research-project-title"><header className="detail-header"><div><span className="eyebrow">{selected.run.status}</span><h2 id="research-project-title">{selected.name}</h2><p>{selected.question}</p></div><div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => { setProjects((current) => current.map((item) => item.id === selected.id ? { ...item, run: { ...item.run, id: `run-${item.id}-04`, status: 'working', synthesis: 'Research passes are collecting source evidence.' } } : item)); record('POST', `/agent-research/projects/${selected.id}/runs`, 'Manual project run started with {triggerType:"manual"}'); }} data-testid="research-start-run"><Icon name="resume" size={13} />Start run</button><button className="text-danger-button" type="button" onClick={() => { setProjects((current) => current.map((item) => item.id === selected.id ? { ...item, status: 'archived' } : item)); record('POST', `/agent-research/projects/${selected.id}/archive`, 'Research project archived'); }} data-testid="research-archive"><Icon name="archive" size={13} />Archive project</button></div></header><div className="research-tabs" role="tablist" aria-label="Research evidence"><button role="tab" aria-selected="true" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}`, 'Run synthesis opened')}>Synthesis</button><button role="tab" aria-selected="false" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}`, 'Pass evidence opened')}>Passes</button><button role="tab" aria-selected="false" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}`, 'Contrarian review opened')}>Contrarian Review</button><button role="tab" aria-selected="false" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}`, 'Curated sources opened')}>Sources</button><button role="tab" aria-selected="false" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}`, 'Run statistics opened')}>Statistics</button></div><article className="research-report"><span className={`state-badge ${selected.run.status}`}>{selected.run.status}</span><h3>Run {selected.run.id}</h3><p>{selected.run.synthesis}</p>{selected.run.status === 'failed' && <button className="primary-button" type="button" onClick={() => { setProjects((current) => current.map((item) => item.id === selected.id ? { ...item, run: { ...item.run, status: 'working', synthesis: 'Retry is gathering source evidence.' } } : item)); record('POST', `/agent-research/${selected.run.id}/retry`, 'Failed legacy research job retried'); }} data-testid="research-retry">Retry</button>}<div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => record('LOCAL', 'clipboard.writeText', 'Research result copied')} data-testid="research-copy"><Icon name="copy" size={13} />Copy results</button><button className="secondary-button compact" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}/magazine`, 'Magazine view opened')} data-testid="research-magazine">Magazine</button><button className="secondary-button compact" type="button" onClick={() => record('GET', `/agent-research/projects/${selected.id}/runs/${selected.run.id}/export?format=html`, 'HTML export prepared')} data-testid="research-export">Export HTML</button><button className="secondary-button compact" type="button" onClick={() => record('POST', `/agent-research/projects/${selected.id}/runs/${selected.run.id}/discussions`, 'Discussion session created from selected artifacts')} data-testid="research-discuss">Start discussion</button></div></article></section></div>
    <FocusDialog open={projectDialog} onClose={() => setProjectDialog(false)} title="Create research project" description="Define the project question and evidence goals." testId="research-project-dialog" wide><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const id = `research-project-${projects.length + 1}`; const project: ResearchProject = { id, name: String(data.get('name')), question: String(data.get('question')), status: 'active', run: { id: `${id}-run-01`, status: 'working', synthesis: 'The first research pass is queued.' } }; setProjects((current) => [...current, project]); setSelectedId(id); setProjectDialog(false); record('POST', '/agent-research/projects', 'Research project created from {name,question,goals,domain,profileId,passConfig,modelPolicy,criticConfig,synthesisConfig,budget}'); }}><label className="field">Project name<input name="name" required data-autofocus /></label><label className="field">Domain<input name="domain" defaultValue="operations" /></label><label className="field span-2">Research question<textarea name="question" required rows={3} /></label><label className="field span-2">Goals (one per line)<textarea name="goals" defaultValue={'Verified sources\nActionable synthesis'} rows={3} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setProjectDialog(false)}>Cancel</button><button className="primary-button" type="submit" data-testid="research-project-create">Create project</button></footer></form></FocusDialog>
    <FocusDialog open={legacyDialog} onClose={() => setLegacyDialog(false)} title="New Research" description="Start a bounded legacy research job." testId="research-legacy-dialog"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setLegacyDialog(false); record('POST', '/agent-research', `Research started at ${String(data.get('depth'))} depth with {query,depth}`); }}><label className="field span-2">Question / Topic<textarea name="query" required data-autofocus placeholder="What would you like to research?" /></label><fieldset className="radio-stack span-2"><legend>Depth</legend><label><input type="radio" name="depth" value="standard" defaultChecked />Standard</label><label><input type="radio" name="depth" value="deep" />Deep</label></fieldset><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setLegacyDialog(false)}>Cancel</button><button className="primary-button" type="submit" data-testid="research-legacy-start">Start</button></footer></form></FocusDialog>
  </ToolFrame>;
}

// Live research projects — apps/web/src/gateway/research.ts's ResearchProject/ResearchProjectRun
// mirror apps/api_server/src/repositories/agent_research_repository.ts:34-77. The quick-create
// dialog only surfaces name/question/domain/goals; profileId/passConfig/modelPolicy/criticConfig/
// synthesisConfig/scheduleRef/budget use the redspec's documented starter defaults (a single
// evidence-gathering pass, critic+synthesis enabled, a bounded budget) rather than fixture-invented
// values, since the API requires all of them on create (agentResearchController.ts:92-106).
function LiveResearchTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [projects, setProjects] = useState<LiveResearchProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ResearchProjectRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<ResearchProjectRun | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-research/projects', detail: 'Loading research projects' });
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0] ?? null;
  const latestRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  const loadProjects = async () => {
    setError(null);
    try {
      const next = await gateway.domains.research!.listProjects();
      setProjects(next);
      setSelectedId((current) => (current && next.some((project) => project.id === current) ? current : (next[0]?.id ?? null)));
      setTrace({ method: 'GET', route: '/agent-research/projects', detail: `${next.length} research projects loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Research projects failed to load'); }
  };
  useEffect(() => { void loadProjects(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) { setRuns([]); setRunDetail(null); return; }
    let active = true;
    gateway.domains.research!.listRuns(selected.id)
      .then((next) => { if (active) { setRuns(next); setSelectedRunId(next[0]?.id ?? null); } })
      .catch(() => { if (active) setRuns([]); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || !latestRun) { setRunDetail(null); return; }
    let active = true;
    gateway.domains.research!.getRun(selected.id, latestRun.id)
      .then((run) => { if (active) setRunDetail(run); })
      .catch(() => { if (active) setRunDetail(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, latestRun?.id]);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const goals = String(data.get('goals')).split('\n').map((value) => value.trim()).filter(Boolean);
    const input = {
      name: String(data.get('name')),
      question: String(data.get('question')),
      goals,
      domain: String(data.get('domain') || '') || null,
      profileId: 'research',
      passConfig: [{ role: 'evidence', profileId: 'research' }],
      modelPolicy: {},
      criticConfig: { enabled: true },
      synthesisConfig: { enabled: true },
      scheduleRef: null,
      budget: { maxPasses: 1, maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
    };
    try {
      const created = await gateway.domains.research!.createProject(input);
      setProjects((current) => (current.some((project) => project.id === created.id) ? current.map((project) => (project.id === created.id ? created : project)) : [...current, created]));
      setSelectedId(created.id);
      setTrace({ method: 'POST', route: '/agent-research/projects', detail: 'Research project created' });
      setProjectDialog(false);
    } catch (err) { notify(err instanceof Error ? err.message : 'Research project creation failed'); }
  };

  const startRun = async () => {
    if (!selected) return;
    try {
      const run = await gateway.domains.research!.startRun(selected.id);
      setRuns((current) => [run, ...current]);
      setSelectedRunId(run.id);
      setTrace({ method: 'POST', route: `/agent-research/projects/${selected.id}/runs`, detail: 'Manual project run started with {triggerType:"manual"}' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Research run failed to start'); }
  };

  const archiveProject = async () => {
    if (!selected) return;
    try {
      const archived = await gateway.domains.research!.archiveProject(selected.id);
      setProjects((current) => current.map((project) => (project.id === archived.id ? archived : project)));
      setTrace({ method: 'POST', route: `/agent-research/projects/${selected.id}/archive`, detail: 'Research project archived' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Research project archive failed'); }
  };

  const cancelRun = async () => {
    if (!selected || !latestRun) return;
    try {
      const run = await gateway.domains.research!.cancelRun(selected.id, latestRun.id);
      setRunDetail(run);
      setTrace({ method: 'POST', route: `/agent-research/projects/${selected.id}/runs/${latestRun.id}/cancel`, detail: 'Research run canceled' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Research run cancel failed'); }
  };

  const resumeRun = async () => {
    if (!selected || !latestRun) return;
    try {
      const run = await gateway.domains.research!.resumeRun(selected.id, latestRun.id);
      setRunDetail(run);
      setTrace({ method: 'POST', route: `/agent-research/projects/${selected.id}/runs/${latestRun.id}/resume`, detail: 'Research run resumed' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Research run resume failed'); }
  };

  const openExport = async (format: 'html' | 'markdown') => {
    if (!selected || !latestRun) return;
    try {
      const text = await gateway.domains.research!.exportRun(selected.id, latestRun.id, format);
      const blobUrl = URL.createObjectURL(new Blob([text], { type: format === 'html' ? 'text/html' : 'text/markdown' }));
      window.open(blobUrl, '_blank', 'noopener');
      setTrace({ method: 'GET', route: `/agent-research/projects/${selected.id}/runs/${latestRun.id}/export?format=${format}`, detail: `${format} export prepared` });
    } catch (err) { notify(err instanceof Error ? err.message : 'Research export failed'); }
  };

  const openMagazine = async () => {
    if (!selected || !latestRun) return;
    try {
      const html = await gateway.domains.research!.magazine(selected.id, latestRun.id);
      window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank', 'noopener');
      setTrace({ method: 'GET', route: `/agent-research/projects/${selected.id}/runs/${latestRun.id}/magazine`, detail: 'Magazine view opened' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Magazine view failed'); }
  };

  const discuss = async () => {
    if (!selected || !latestRun) return;
    try {
      await gateway.domains.research!.startDiscussion(selected.id, latestRun.id, []);
      setTrace({ method: 'POST', route: `/agent-research/projects/${selected.id}/runs/${latestRun.id}/discussions`, detail: 'Discussion session created from selected artifacts' });
      navigate('/agents');
    } catch (err) { notify(err instanceof Error ? err.message : 'Discussion could not be started'); }
  };

  const sourceLabel = (source: Record<string, unknown>) => (typeof source.title === 'string' ? source.title : typeof source.id === 'string' ? source.id : 'Untitled source');

  return <ToolFrame slug="deep-research" title="Research Projects" description="Run multi-pass research, inspect evidence, and keep discussion and export actions attached to a project run." trace={trace} actions={<button className="primary-button" type="button" onClick={() => setProjectDialog(true)} data-testid="research-new-project"><Icon name="plus" size={14} />Create project</button>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="research-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {!error && projects.length === 0 && <EmptyState title="No research projects yet">Create a project to keep multi-pass evidence, sources, and discussion in one place.</EmptyState>}
    {selected && <div className="tool-split research-layout">
      <aside className="tool-rail" aria-label="Research projects"><h2>Projects</h2>{projects.map((project) => <button className={project.id === selected.id ? 'selected' : ''} type="button" key={project.id} onClick={() => setSelectedId(project.id)} data-testid={`research-project-${project.id}`}><strong>{project.name}</strong><small>{project.archivedAt ? 'archived' : 'active'}</small></button>)}</aside>
      <section className="tool-detail" aria-labelledby="research-project-title">
        <header className="detail-header">
          <div><h2 id="research-project-title">{selected.name}</h2><p>{selected.question}</p></div>
          <div className="row-actions">
            <button className="secondary-button compact" type="button" onClick={() => void startRun()} data-testid="research-start-run"><Icon name="resume" size={13} />Start run</button>
            <button className="text-danger-button" type="button" onClick={() => void archiveProject()} disabled={Boolean(selected.archivedAt)} data-testid="research-archive"><Icon name="archive" size={13} />Archive project</button>
          </div>
        </header>
        {runDetail ? <article className="research-report">
          <span className={`state-badge ${runDetail.status}`}>{runDetail.status}</span>
          <h3>Run {runDetail.id}</h3>
          {runDetail.status === 'error' && <button className="primary-button" type="button" onClick={() => void resumeRun()} data-testid="research-resume">Resume</button>}
          {(runDetail.status === 'working' || runDetail.status === 'pending') && <button className="secondary-button compact" type="button" onClick={() => void cancelRun()} data-testid="research-cancel">Cancel</button>}
          <section aria-label="Curated sources"><h4>Sources</h4>{runDetail.sources.length === 0 ? <p className="tool-empty-inline">No sources yet.</p> : <ul>{runDetail.sources.map((source, index) => <li key={typeof source.id === 'string' ? source.id : index}>{sourceLabel(source)}</li>)}</ul>}</section>
          <section aria-label="Run statistics"><h4>Usage</h4><p>{runDetail.usage.tokens} tokens · ${runDetail.usage.costUsd.toFixed(2)}</p></section>
          <div className="row-actions">
            <button className="secondary-button compact" type="button" onClick={() => void openMagazine()} data-testid="research-magazine">Magazine</button>
            <button className="secondary-button compact" type="button" onClick={() => void openExport('html')} data-testid="research-export">Export HTML</button>
            <button className="secondary-button compact" type="button" onClick={() => void discuss()} data-testid="research-discuss">Start discussion</button>
          </div>
        </article> : <p className="tool-empty-inline">No runs yet for this project.</p>}
      </section>
    </div>}
    <FocusDialog open={projectDialog} onClose={() => setProjectDialog(false)} title="Create research project" description="Define the project question and evidence goals." testId="research-project-dialog" wide><form className="form-grid" onSubmit={(event) => void createProject(event)}><label className="field">Project name<input name="name" required data-autofocus /></label><label className="field">Domain<input name="domain" defaultValue="operations" /></label><label className="field span-2">Research question<textarea name="question" required rows={3} /></label><label className="field span-2">Goals (one per line)<textarea name="goals" defaultValue="Preserve evidence" rows={3} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setProjectDialog(false)}>Cancel</button><button className="primary-button" type="submit" data-testid="research-project-create">Create project</button></footer></form></FocusDialog>
  </ToolFrame>;
}

type Schedule = { id: string; name: string; prompt: string; type: string; enabled: boolean; lastRun: string; runState: string };
function FixtureSchedulesTool() {
  const { notify } = useFixtures(); const [items, setItems] = useState<Schedule[]>([{ id: 'schedule-digest', name: 'Monday planning digest', prompt: 'Summarize open work and unresolved owners.', type: 'weekly', enabled: true, lastRun: 'Aug 10, 9:00 AM', runState: 'completed' }, { id: 'schedule-health', name: 'Integration health sweep', prompt: 'Check configured agent integrations.', type: 'daily', enabled: false, lastRun: 'Aug 11, 8:00 AM', runState: 'error' }]);
  const [selectedId, setSelectedId] = useState(items[0].id); const [editing, setEditing] = useState<Schedule | 'new' | null>(null); const [deleting, setDeleting] = useState<Schedule | null>(null); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-schedules', detail: 'Scheduled jobs loaded' }); const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const patch = { name: String(data.get('name')), prompt: String(data.get('prompt')), type: String(data.get('type')), enabled: data.get('enabled') === 'on' }; if (editing === 'new') { const item = { id: `schedule-${items.length + 1}`, ...patch, lastRun: 'Never', runState: 'idle' }; setItems((current) => [...current, item]); setSelectedId(item.id); record('POST', '/agent-schedules', 'Schedule created with name, prompt, scheduleType, timezone, enabled, and profile'); } else if (editing) { setItems((current) => current.map((item) => item.id === editing.id ? { ...item, ...patch } : item)); record('PATCH', `/agent-schedules/${editing.id}`, 'Schedule updated'); } setEditing(null); };
  return <ToolFrame slug="tasks" title="Agent Schedules" description="Create and operate recurring or one-time agent jobs, with linked session history." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => record('GET', '/agent-schedules', 'Schedules refreshed')} data-testid="schedules-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="schedule-new"><Icon name="plus" size={14} />New Schedule</button></>}>
    <div className="tool-split"><aside className="tool-rail" aria-label="Scheduled agent jobs">{items.map((item) => <button className={item.id === selected.id ? 'selected' : ''} type="button" key={item.id} onClick={() => { setSelectedId(item.id); record('GET', `/agent-sessions?scheduledTaskId=${item.id}`, 'Recent scheduled runs loaded'); }} data-testid={`schedule-${item.id}`}><strong>{item.name}</strong><small>{item.type} · {item.enabled ? 'Enabled' : 'Disabled'}</small></button>)}</aside><section className="tool-detail"><header className="detail-header"><div><span className={`state-badge ${selected.enabled ? 'completed' : ''}`}>{selected.enabled ? 'Enabled' : 'Disabled'}</span><h2>{selected.name}</h2><p>{selected.prompt}</p></div><div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => { setItems((current) => current.map((item) => item.id === selected.id ? { ...item, enabled: !item.enabled } : item)); record('PATCH', `/agent-schedules/${selected.id}`, `Schedule ${selected.enabled ? 'disabled' : 'enabled'}`); }} data-testid="schedule-toggle">{selected.enabled ? 'Disable' : 'Enable'}</button><button className="secondary-button compact" type="button" onClick={() => setEditing(selected)} data-testid="schedule-edit"><Icon name="rename" size={13} />Edit</button><button className="text-danger-button" type="button" onClick={() => setDeleting(selected)} data-testid="schedule-delete"><Icon name="delete" size={13} />Delete</button></div></header><dl className="tool-properties"><div><dt>Schedule Type</dt><dd>{selected.type}</dd></div><div><dt>Timezone</dt><dd>America/Los_Angeles</dd></div><div><dt>Last run</dt><dd>{selected.lastRun}</dd></div></dl><div className="run-history"><header><h3>Run history</h3><button className="primary-button" type="button" onClick={() => { setItems((current) => current.map((item) => item.id === selected.id ? { ...item, lastRun: 'Aug 12, 3:48 PM', runState: 'working' } : item)); record('POST', `/agent-schedules/${selected.id}/trigger-now`, 'Scheduled job triggered now'); }} data-testid="schedule-trigger"><Icon name="resume" size={13} />Trigger now</button></header><button type="button" onClick={() => record('GET', `/agent-sessions?scheduledTaskId=${selected.id}`, 'Opened linked run session')}><span className={`status-dot ${selected.runState}`} /><strong>{selected.name} · manual run</strong><small>{selected.runState} · {selected.lastRun}</small></button></div></section></div>
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New Schedule' : 'Edit Schedule'} description="Schedule times use America/Los_Angeles." testId="schedule-editor" wide><form className="form-grid" onSubmit={save}><label className="field">Name<input name="name" required data-autofocus defaultValue={editing && editing !== 'new' ? editing.name : ''} /></label><label className="field">Schedule Type<select name="type" defaultValue={editing && editing !== 'new' ? editing.type : 'daily'}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="cron">Cron Expression</option><option value="once">Once</option></select></label><label className="field span-2">Instructions / Prompt<textarea name="prompt" required rows={4} defaultValue={editing && editing !== 'new' ? editing.prompt : ''} /></label><label className="check-label span-2"><input type="checkbox" name="enabled" defaultChecked={editing && editing !== 'new' ? editing.enabled : true} />Enabled</label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="schedule-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete scheduled task?" description={deleting ? `Delete “${deleting.name}”? This cannot be undone.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (!deleting) return; setItems((current) => current.filter((item) => item.id !== deleting.id)); record('DELETE', `/agent-schedules/${deleting.id}`, 'Scheduled task deleted'); setSelectedId(items.find((item) => item.id !== deleting.id)?.id || ''); setDeleting(null); }} testId="schedule-delete-dialog" />
  </ToolFrame>;
}

// Live schedules surface — apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts:5-31
// and agent_scheduled_task_runs_repository.ts:15-33 are the canonical persisted shapes. Run rows
// carry a durable `rootSessionId`; navigation reads it through ScheduleGateway.rootSession rather
// than the fixture's synthetic `/agent-sessions?scheduledTaskId=` query.
function LiveSchedulesTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-schedules', detail: 'Loading live schedules' });
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;

  const loadTasks = async () => {
    setError(null);
    try {
      const next = await gateway.domains.schedules!.list();
      setTasks(next);
      setSelectedId((current) => (current && next.some((task) => task.id === current) ? current : (next[0]?.id ?? null)));
      setTrace({ method: 'GET', route: '/agent-schedules', detail: `${next.length} schedules loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Schedules failed to load'); }
  };
  useEffect(() => { void loadTasks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRuns = async (id: string) => {
    setRunsError(null);
    try { setRuns(await gateway.domains.schedules!.runs(id)); }
    catch (err) { setRuns([]); setRunsError(err instanceof Error ? err.message : 'Run history failed to load'); }
  };
  useEffect(() => { if (selected) void loadRuns(selected.id); else setRuns([]); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRun = async (run: ScheduledTaskRun) => {
    if (!run.rootSessionId) return;
    try {
      await gateway.domains.schedules!.rootSession(run.rootSessionId);
      setTrace({ method: 'GET', route: `/agent-sessions/${run.rootSessionId}`, detail: 'Opened linked run session' });
      navigate('/agents');
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not open the linked session'); }
  };

  const toggleEnabled = async (task: ScheduledTask) => {
    try {
      const next = await gateway.domains.schedules!.update(task.id, { enabled: !task.enabled });
      setTasks((current) => current.map((item) => (item.id === next.id ? next : item)));
      setTrace({ method: 'PATCH', route: `/agent-schedules/${task.id}`, detail: `Schedule ${next.enabled ? 'enabled' : 'disabled'}` });
    } catch (err) { notify(err instanceof Error ? err.message : 'Schedule update failed'); }
  };

  const triggerNow = async () => {
    if (!selected) return;
    try {
      const next = await gateway.domains.schedules!.triggerNow(selected.id);
      setTasks((current) => current.map((item) => (item.id === next.id ? next : item)));
      setTrace({ method: 'POST', route: `/agent-schedules/${selected.id}/trigger-now`, detail: 'Scheduled job triggered now' });
      void loadRuns(selected.id);
    } catch (err) { notify(err instanceof Error ? err.message : 'Trigger failed'); }
  };

  const removeTask = async (task: ScheduledTask) => {
    try {
      await gateway.domains.schedules!.remove(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setTrace({ method: 'DELETE', route: `/agent-schedules/${task.id}`, detail: 'Scheduled task deleted' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Delete failed'); }
    setDeleting(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: ScheduledTaskInput = { name: String(data.get('name')), prompt: String(data.get('prompt')), scheduleType: String(data.get('type')), enabled: data.get('enabled') === 'on' };
    try {
      if (editing === 'new') {
        const created = await gateway.domains.schedules!.create(input);
        setTasks((current) => [...current, created]); setSelectedId(created.id);
        setTrace({ method: 'POST', route: '/agent-schedules', detail: 'Schedule created' });
      } else if (editing) {
        const updated = await gateway.domains.schedules!.update(editing.id, input);
        setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setTrace({ method: 'PATCH', route: `/agent-schedules/${editing.id}`, detail: 'Schedule updated' });
      }
    } catch (err) { notify(err instanceof Error ? err.message : 'Save failed'); }
    setEditing(null);
  };

  return <ToolFrame slug="tasks" title="Agent Schedules" description="Create and operate recurring or one-time agent jobs, with linked session history." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => void loadTasks()} data-testid="schedules-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="schedule-new"><Icon name="plus" size={14} />New Schedule</button></>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="schedules-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {!error && tasks.length === 0 && <EmptyState title="No schedules yet">Create a schedule for recurring work or a one-time agent job.</EmptyState>}
    {selected && <div className="tool-split">
      <aside className="tool-rail" aria-label="Scheduled agent jobs">{tasks.map((task) => <button className={task.id === selected.id ? 'selected' : ''} type="button" key={task.id} onClick={() => setSelectedId(task.id)} data-testid={`schedule-${task.id}`}><strong>{task.name}</strong><small>{task.scheduleType} · {task.enabled ? 'Enabled' : 'Disabled'}</small></button>)}</aside>
      <section className="tool-detail">
        <header className="detail-header">
          <div><span className={`state-badge ${selected.enabled ? 'completed' : ''}`}>{selected.enabled ? 'Enabled' : 'Disabled'}</span><h2>{selected.name}</h2><p>{selected.prompt}</p></div>
          <div className="row-actions">
            <button className="secondary-button compact" type="button" onClick={() => void toggleEnabled(selected)} data-testid="schedule-toggle">{selected.enabled ? 'Disable' : 'Enable'}</button>
            <button className="secondary-button compact" type="button" onClick={() => setEditing(selected)} data-testid="schedule-edit"><Icon name="rename" size={13} />Edit</button>
            <button className="text-danger-button" type="button" onClick={() => setDeleting(selected)} data-testid="schedule-delete"><Icon name="delete" size={13} />Delete</button>
          </div>
        </header>
        <dl className="tool-properties">
          <div><dt>Schedule Type</dt><dd>{selected.scheduleType}</dd></div>
          <div><dt>Timezone</dt><dd>{selected.timezone}</dd></div>
          <div><dt>Last run</dt><dd>{selected.lastRunAt ?? 'Never'}</dd></div>
        </dl>
        <div className="run-history">
          <header><h3>Run history</h3><button className="primary-button" type="button" onClick={() => void triggerNow()} data-testid="schedule-trigger"><Icon name="resume" size={13} />Trigger now</button></header>
          {runsError && <p role="alert">{runsError}</p>}
          {runs.map((run) => <button key={run.id} type="button" onClick={() => void openRun(run)} data-testid={`schedule-run-${run.id}`}><span className={`status-dot ${run.status}`} /><strong>{run.startedAt}</strong><small>{run.status}{run.error ? ` · ${run.error}` : ''}</small></button>)}
          {runs.length === 0 && !runsError && <p className="tool-empty-inline">No runs yet.</p>}
        </div>
      </section>
    </div>}
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New Schedule' : 'Edit Schedule'} description="Schedule times use the task's own timezone." testId="schedule-editor" wide><form className="form-grid" onSubmit={save}><label className="field">Name<input name="name" required data-autofocus defaultValue={editing && editing !== 'new' ? editing.name : ''} /></label><label className="field">Schedule Type<select name="type" defaultValue={editing && editing !== 'new' ? editing.scheduleType : 'daily'}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="cron">Cron Expression</option><option value="once">Once</option></select></label><label className="field span-2">Instructions / Prompt<textarea name="prompt" required rows={4} defaultValue={editing && editing !== 'new' ? editing.prompt : ''} /></label><label className="check-label span-2"><input type="checkbox" name="enabled" defaultChecked={editing && editing !== 'new' ? editing.enabled : true} />Enabled</label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="schedule-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete scheduled task?" description={deleting ? `Delete “${deleting.name}”? This cannot be undone.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) void removeTask(deleting); }} testId="schedule-delete-dialog" />
  </ToolFrame>;
}

type Webhook = { id: string; name: string; url: string; prompt: string; enabled: boolean; triggers: number; last: string };
function WebhooksTool() {
  const { notify } = useFixtures(); const [items, setItems] = useState<Webhook[]>([{ id: 'webhook-github', name: 'GitHub Push Handler', url: 'http://localhost:4001/agent-webhooks/webhook-github/receive', prompt: 'Review changed files and open a bounded agent session.', enabled: true, triggers: 12, last: 'Aug 12, 3:42 PM' }]); const [createOpen, setCreateOpen] = useState(false); const [deleting, setDeleting] = useState<Webhook | null>(null); const [createdUrl, setCreatedUrl] = useState(''); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-webhooks', detail: 'Webhook endpoints loaded' }); const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  return <ToolFrame slug="webhooks" title="Webhook Endpoints" description="Manage private inbound trigger URLs and delivery history." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => record('GET', '/agent-webhooks', 'Webhooks refreshed')} data-testid="webhooks-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setCreateOpen(true)} data-testid="webhook-new"><Icon name="plus" size={14} />New webhook</button></>}>
    <div className="tool-list">{items.map((item) => <article className="tool-row webhook-row" key={item.id}><span className="tool-icon"><Icon name="webhook" /></span><span><strong>{item.name}</strong><code>{item.url}</code><small>{item.triggers} triggers · Last triggered {item.last}</small></span><span className={`state-badge ${item.enabled ? 'completed' : ''}`}>{item.enabled ? 'Enabled' : 'Disabled'}</span><button className="icon-button small" type="button" aria-label={`Copy receive URL for ${item.name}`} onClick={() => record('LOCAL', 'clipboard.writeText', 'Receive URL copied')} data-testid={`webhook-copy-${item.id}`}><Icon name="copy" size={14} /></button><button className="icon-button small" type="button" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(item)} data-testid={`webhook-delete-${item.id}`}><Icon name="delete" size={14} /></button></article>)}</div>
    <FocusDialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Webhook" description="The receive URL is shown once after creation." testId="webhook-editor"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const id = `webhook-${items.length + 1}`; const url = `http://localhost:4001/agent-webhooks/${id}/receive`; setItems((current) => [...current, { id, name: String(data.get('name')), url, prompt: String(data.get('prompt')), enabled: data.get('enabled') === 'on', triggers: 0, last: 'Never' }]); setCreatedUrl(url); setCreateOpen(false); record('POST', '/agent-webhooks', 'Webhook created with {name,eventTypesJson,targetPrompt?,enabled}'); }}><label className="field span-2">Name<input name="name" required data-autofocus placeholder="e.g. GitHub Push Handler" /></label><label className="field span-2">Target prompt (optional)<textarea name="prompt" placeholder="Instructions for the agent when this webhook fires…" rows={4} /></label><label className="check-label span-2"><input type="checkbox" name="enabled" defaultChecked />Enabled</label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>Cancel</button><button className="primary-button" type="submit" data-testid="webhook-create">Create</button></footer></form></FocusDialog>
    <FocusDialog open={Boolean(createdUrl)} onClose={() => setCreatedUrl('')} title="Webhook created!" description="Keep this URL private - it includes your webhook secret." testId="webhook-success"><div className="secret-value"><span>Receive URL</span><code>{createdUrl}</code></div><div className="dialog-actions"><button className="primary-button" type="button" onClick={() => { record('LOCAL', 'clipboard.writeText', 'Receive URL copied to clipboard'); setCreatedUrl(''); }} data-testid="webhook-copy-created"><Icon name="copy" size={14} />Copy receive URL</button></div></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete webhook?" description={deleting ? `Deleting “${deleting.name}” immediately revokes its receive URL.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (!deleting) return; setItems((current) => current.filter((item) => item.id !== deleting.id)); record('DELETE', `/agent-webhooks/${deleting.id}`, 'Webhook endpoint deleted'); setDeleting(null); }} testId="webhook-delete-dialog" />
  </ToolFrame>;
}

type ManagedItem = { id: string; name: string; description: string; source: string; managed: boolean; body: string };
function ManagedCatalog({ kind }: { kind: 'skills' | 'playbooks' }) {
  const isSkills = kind === 'skills'; const title = isSkills ? 'Skills' : 'Playbooks'; const singular = isSkills ? 'skill' : 'playbook'; const base = isSkills ? '/opencode/skills' : '/opencode/commands'; const { notify } = useFixtures();
  const [items, setItems] = useState<ManagedItem[]>(isSkills ? [{ id: 'verification', name: 'verification', description: 'Fixture skill for deterministic UI checks.', source: 'fixture', managed: true, body: '# Verification\n\nFixture content only.' }, { id: 'research', name: 'research', description: 'Read-only fixture skill.', source: 'fixture', managed: false, body: '# Research\n\nFixture content only.' }] : [{ id: 'review', name: 'review', description: 'Review the active project and report prioritized findings.', source: 'command', managed: true, body: 'Review $ARGUMENTS and cite the affected files.' }, { id: 'status', name: 'status', description: 'Summarize the current session state.', source: 'built-in', managed: false, body: 'Read-only built-in command.' }]);
  const [selectedId, setSelectedId] = useState(items[0].id); const [query, setQuery] = useState(''); const [editing, setEditing] = useState<ManagedItem | 'new' | null>(null); const [deleting, setDeleting] = useState<ManagedItem | null>(null); const listRoute = isSkills ? 'fixture://skills' : base; const [trace, setTrace] = useState<Trace>({ method: isSkills ? 'LOCAL' : 'GET', route: listRoute, detail: `${title} fixture loaded` }); const visible = items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())); const selected = items.find((item) => item.id === selectedId) ?? items[0]; const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get('name')).trim(); const next = { id: name, name, description: String(data.get('description')), source: isSkills ? 'fixture' : 'managed', managed: true, body: String(data.get('body')) }; const route = isSkills ? `fixture://skills/${encodeURIComponent(name)}` : base; if (editing === 'new') { setItems((current) => [...current, next]); setSelectedId(next.id); record(isSkills ? 'LOCAL' : 'POST', route, `${singular} fixture created`); } else if (editing) { setItems((current) => current.map((item) => item.id === editing.id ? { ...item, ...next, id: editing.id, name: editing.name } : item)); record(isSkills ? 'LOCAL' : 'PUT', isSkills ? `fixture://skills/${encodeURIComponent(editing.name)}` : `${base}/${encodeURIComponent(editing.name)}`, `${singular} fixture updated`); } setEditing(null); };
  return <ToolFrame slug={kind} title={title} description={isSkills ? 'Deterministic fixture skills for UI preview only. Switch to Live mode to inspect or edit the engine catalog.' : 'Manage the custom slash commands that appear in the Agents composer.'} trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => { record(isSkills ? 'LOCAL' : 'GET', listRoute, `${title} fixture refreshed`); }} data-testid={`${kind}-refresh`}><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid={`${kind}-new`}><Icon name="plus" size={14} />New {singular}</button></>}>
    {!isSkills && <div className="tool-notice"><Icon name="command" size={15} /><span>Managed playbooks appear as <strong>/slash commands</strong> in every session composer after refresh.</span></div>}
    <div className="tool-filterbar"><label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search {kind}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kind} by name or description…`} data-testid={`${kind}-search`} /></label><span>{visible.length} {kind}</span></div>
    {visible.length === 0 && <div className="tool-search-empty" data-testid={`${kind}-no-results`}><EmptyState title={`No ${kind} match`}>Try another term or clear the search to restore the full catalog.</EmptyState><button className="secondary-button" type="button" onClick={() => setQuery('')} data-testid={`${kind}-clear-search`}><Icon name="close" size={14} />Clear search</button></div>}
    {visible.length > 0 &&
    <div className="tool-split"><aside className="tool-rail">{visible.map((item) => <button type="button" className={item.id === selected.id ? 'selected' : ''} key={item.id} onClick={() => { setSelectedId(item.id); record(isSkills ? 'LOCAL' : 'GET', isSkills ? `fixture://skills/${encodeURIComponent(item.name)}` : `${base}/${encodeURIComponent(item.name)}/content`, `${singular} fixture opened`); }} data-testid={`${kind}-item-${item.id}`}><strong>{isSkills ? item.name : `/${item.name}`}</strong><small>{item.source} · {item.managed ? 'Managed' : 'Read only'}</small></button>)}</aside><section className="tool-detail"><header className="detail-header"><div><span className="kind-badge">{selected.source}</span><h2>{isSkills ? selected.name : `/${selected.name}`}</h2><p>{selected.description}</p></div>{selected.managed && <div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(selected)} data-testid={`${kind}-edit`}><Icon name="rename" size={13} />Edit</button><button className="text-danger-button" type="button" onClick={() => setDeleting(selected)} data-testid={`${kind}-delete`}><Icon name="delete" size={13} />Delete</button></div>}</header><pre className="managed-body">{selected.body}</pre></section></div>
    }
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? `New ${singular}` : `Edit ${singular}`} description={isSkills ? 'Managed skills are discovered through the engine store.' : 'The template is invoked from the composer as a slash command.'} testId={`${kind}-editor`} wide><form className="form-grid" onSubmit={save}><label className="field">Name<input name="name" required data-autofocus defaultValue={editing && editing !== 'new' ? editing.name : ''} disabled={editing !== 'new'} /></label><label className="field">Description<input name="description" defaultValue={editing && editing !== 'new' ? editing.description : ''} /></label><label className="field span-2">{isSkills ? 'SKILL.md content' : 'Command template'}<textarea name="body" required rows={8} defaultValue={editing && editing !== 'new' ? editing.body : ''} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid={`${kind}-save`}>Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title={`Delete ${title.slice(0, -1)}`} description={deleting ? `Delete “${deleting.name}” from this ${isSkills ? 'fixture' : 'catalog'}?` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (!deleting) return; setItems((current) => current.filter((item) => item.id !== deleting.id)); record(isSkills ? 'LOCAL' : 'DELETE', isSkills ? `fixture://skills/${encodeURIComponent(deleting.name)}` : `${base}/${encodeURIComponent(deleting.name)}`, `${singular} fixture deleted`); setSelectedId(items.find((item) => item.id !== deleting.id)?.id || ''); setDeleting(null); }} testId={`${kind}-delete-dialog`} />
  </ToolFrame>;
}

function LiveSkillsTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<SkillEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SkillEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/opencode/skills?withMetadata=true', detail: 'Loading live skill catalog' });
  const visible = skills.filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const selected = visible.find((skill) => skill.name === selectedName) ?? visible[0] ?? null;

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const next = await gateway.domains.skills!.list(true);
      setSkills(next);
      setSelectedName((current) => (current && next.some((skill) => skill.name === current) ? current : (next[0]?.name ?? null)));
      setTrace({ method: 'GET', route: '/opencode/skills?withMetadata=true', detail: `${next.length} live skills loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Skill catalog failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) { setContent(''); setContentLoading(false); setContentError(null); return; }
    let active = true;
    setContent('');
    setContentError(null);
    setContentLoading(true);
    gateway.domains.skills!.content(selected.name)
      .then((next) => { if (active) setContent(next.content); })
      .catch((err) => { if (active) setContentError(err instanceof Error ? err.message : 'Skill content failed to load'); })
      .finally(() => { if (active) setContentLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.name]);

  const refresh = async () => {
    try {
      await gateway.domains.skills!.reload();
      setTrace({ method: 'POST', route: '/system/refresh', detail: 'Engine skill catalog refreshed' });
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Skill refresh failed'); }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    const input = { description: String(data.get('description') || '').trim() || undefined, content: String(data.get('body')) };
    try {
      if (editing === 'new') {
        await gateway.domains.skills!.create({ name, ...input });
        setTrace({ method: 'POST', route: '/opencode/skills', detail: `Managed skill ${name} created` });
      } else if (editing) {
        await gateway.domains.skills!.update(editing.name, input);
        setTrace({ method: 'PUT', route: `/opencode/skills/${encodeURIComponent(editing.name)}`, detail: `Managed skill ${editing.name} updated` });
      }
      setEditing(null);
      setSelectedName(name);
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Skill save failed'); }
  };

  const remove = async (skill: SkillEntry) => {
    try {
      await gateway.domains.skills!.remove(skill.name);
      setTrace({ method: 'DELETE', route: `/opencode/skills/${encodeURIComponent(skill.name)}`, detail: `Managed skill ${skill.name} deleted` });
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Skill delete failed'); }
    setDeleting(null);
  };

  return <ToolFrame slug="skills" title="Skills" description="Search the live engine skill catalog, inspect real metadata, and author Rhythm-managed capabilities." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => void refresh()} data-testid="skills-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="skills-new"><Icon name="plus" size={14} />New skill</button></>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="skills-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {loading && <p role="status">Loading skills…</p>}
    <div className="tool-filterbar"><label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search skills</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills by name or description…" data-testid="skills-search" /></label><span>{visible.length} skills</span></div>
    {!loading && !error && visible.length === 0 && <EmptyState title="No managed skills found">Create a managed skill or refresh after adding one to the engine.</EmptyState>}
    {selected && <div className="tool-split"><aside className="tool-rail">{visible.map((skill) => <button type="button" className={skill.name === selected.name ? 'selected' : ''} key={skill.name} onClick={() => setSelectedName(skill.name)} data-testid={`skills-item-${skill.name}`}><strong>{skill.name}</strong><small>{skill.source} · {skill.managed ? 'Managed' : 'Read only'}</small></button>)}</aside><section className="tool-detail"><header className="detail-header"><div><span className="kind-badge">{selected.source}</span><h2>{selected.name}</h2><p>{selected.description}</p></div>{selected.managed && <div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(selected)} data-testid="skills-edit"><Icon name="rename" size={13} />Edit</button><button className="text-danger-button" type="button" onClick={() => setDeleting(selected)} data-testid="skills-delete"><Icon name="delete" size={13} />Delete</button></div>}</header><dl className="tool-properties"><div><dt>Status</dt><dd>{selected.metadata?.status ?? 'Not measured'}</dd></div><div><dt>Version</dt><dd>{selected.metadata?.version ?? 1}</dd></div><div><dt>Post score</dt><dd>{selected.metadata?.postScore ?? 'Not measured'}</dd></div><div><dt>Uses</dt><dd>{selected.metadata?.uses ?? 'Not measured'}</dd></div></dl><pre className="managed-body" role={contentError ? 'alert' : undefined}>{contentError ?? (contentLoading ? 'Loading…' : content)}</pre></section></div>}
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New skill' : 'Edit skill'} description="Managed skills are discovered through the engine store." testId="skills-editor" wide><form className="form-grid" onSubmit={(event) => void save(event)}><label className="field">Name<input name="name" required data-autofocus defaultValue={editing && editing !== 'new' ? editing.name : ''} disabled={editing !== 'new'} /></label><label className="field">Description<input name="description" defaultValue={editing && editing !== 'new' ? editing.description ?? '' : ''} /></label><label className="field span-2">SKILL.md content<textarea name="body" required rows={8} defaultValue={editing && editing !== 'new' ? content : ''} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="skills-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete skill" description={deleting ? `Delete “${deleting.name}”? This removes the Rhythm-managed skill from the engine.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); }} testId="skills-delete-dialog" />
  </ToolFrame>;
}

// Live playbooks catalog — the engine's real slash-command catalog (opencode_commands_routes.ts:43-64
// merges opencodeClient.listCommands() with a managed flag). `source`/`managed` are rendered verbatim
// (never the fixture's capitalized "Managed"/"Read only" display literals) so this criterion's
// assertion on the raw policy fields holds. Create/update reload the engine config server-side
// (opencode_commands_routes.ts:145,210 -> opencodeClient.reloadConfig()), so a saved playbook is
// dispatchable as /<name> in the composer the moment this list refreshes — no separate dispatch call.
function LivePlaybooksTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState<ManagedCommandContent | null>(null);
  const [editing, setEditing] = useState<CommandEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CommandEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/opencode/commands', detail: 'Loading playbook catalog' });
  const visible = commands.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const selected = visible.find((item) => item.name === selectedName) ?? visible[0] ?? null;

  const load = async () => {
    setError(null);
    try {
      const next = await gateway.domains.commands!.list();
      setCommands(next);
      setSelectedName((current) => (current && next.some((item) => item.name === current) ? current : (next[0]?.name ?? null)));
      setTrace({ method: 'GET', route: '/opencode/commands', detail: `${next.length} playbooks loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Playbook catalog failed to load'); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected?.managed) { setContent(null); return; }
    let active = true;
    gateway.domains.commands!.content(selected.name).then((next) => { if (active) setContent(next); }).catch(() => { if (active) setContent(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.name, selected?.managed]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      name: String(data.get('name')).trim(),
      description: String(data.get('description') || '').trim() || undefined,
      template: String(data.get('body')),
    };
    try {
      if (editing === 'new') {
        await gateway.domains.commands!.create(input);
        setTrace({ method: 'POST', route: '/opencode/commands', detail: `Playbook created and dispatchable as /${input.name}` });
      } else if (editing) {
        await gateway.domains.commands!.update(editing.name, input);
        setTrace({ method: 'PUT', route: `/opencode/commands/${editing.name}`, detail: 'Playbook updated' });
      }
      setEditing(null);
      setSelectedName(input.name);
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Playbook save failed'); }
  };

  const remove = async (item: CommandEntry) => {
    try {
      await gateway.domains.commands!.remove(item.name);
      setTrace({ method: 'DELETE', route: `/opencode/commands/${item.name}`, detail: 'Playbook deleted' });
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Playbook delete failed'); }
    setDeleting(null);
  };

  return <ToolFrame slug="playbooks" title="Playbooks" description="Manage the custom slash commands that appear in the Agents composer." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="playbooks-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="playbooks-new"><Icon name="plus" size={14} />New playbook</button></>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="playbooks-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    <div className="tool-notice"><Icon name="command" size={15} /><span>Managed playbooks appear as <strong>/slash commands</strong> in every session composer after refresh.</span></div>
    <div className="tool-filterbar"><label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search playbooks</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search playbooks by name or description…" data-testid="playbooks-search" /></label><span>{visible.length} playbooks</span></div>
    {!error && visible.length === 0 && <EmptyState title="No playbooks found">Create a playbook to make a reusable slash command available in the composer.</EmptyState>}
    {selected && <div className="tool-split"><aside className="tool-rail">{visible.map((item) => <button type="button" className={item.name === selected.name ? 'selected' : ''} key={item.name} onClick={() => setSelectedName(item.name)} data-testid={`playbook-${item.name}`}><strong>{item.name}</strong><small>{item.source}</small><small>{item.managed ? 'managed' : 'read-only'}</small></button>)}</aside>
      <section className="tool-detail">
        <header className="detail-header">
          <div><h2>Selected playbook</h2><p>{selected.description}</p></div>
          {selected.managed && <div className="row-actions"><button className="secondary-button compact" type="button" onClick={() => setEditing(selected)} data-testid="playbooks-edit"><Icon name="rename" size={13} />Edit</button><button className="text-danger-button" type="button" onClick={() => setDeleting(selected)} data-testid="playbooks-delete"><Icon name="delete" size={13} />Delete</button></div>}
        </header>
        <pre className="managed-body">{content?.template ?? (selected.managed ? 'Loading…' : 'Read-only — this command is not Rhythm-managed.')}</pre>
      </section>
    </div>}
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New playbook' : 'Edit playbook'} description="The template is invoked from the composer as a slash command." testId="playbooks-editor" wide><form className="form-grid" onSubmit={(event) => void save(event)}><label className="field">Name<input name="name" required data-autofocus defaultValue={editing && editing !== 'new' ? editing.name : ''} disabled={editing !== 'new'} /></label><label className="field">Description<input name="description" defaultValue={editing && editing !== 'new' ? editing.description ?? '' : ''} /></label><label className="field span-2">Command template<textarea name="body" required rows={8} defaultValue={editing && editing !== 'new' ? content?.template ?? '' : ''} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="playbooks-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete playbook" description={deleting ? `Delete “${deleting.name}”? This removes the Rhythm-managed playbook from the engine.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); }} testId="playbooks-delete-dialog" />
  </ToolFrame>;
}

type Recipe = { id: string; title: string; description: string; steps: string[]; status: string; sessionId?: string };
function CookbookTool() {
  const { notify, createSession, updateSession } = useFixtures(); const [items, setItems] = useState<Recipe[]>([{ id: 'recipe-handoff', title: 'Review an agent handoff', description: 'Check sources, owners, and verification evidence.', steps: ['Read the handoff', 'Verify unresolved owners', 'Report evidence'], status: 'Ready' }]); const [editing, setEditing] = useState<'new' | null>(null); const [deleting, setDeleting] = useState<Recipe | null>(null); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-cookbook', detail: 'Cookbook recipes loaded' }); const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const patch = { title: String(data.get('title')), description: String(data.get('description')), steps: String(data.get('steps')).split('\n').map((value) => value.trim()).filter(Boolean) }; setItems((current) => [...current, { id: `recipe-${items.length + 1}`, ...patch, status: 'Ready' }]); record('POST', '/agent-cookbook', 'Recipe created with {title,description,stepsJson}'); setEditing(null); };
  return <ToolFrame slug="cookbook" title="Cookbook" description="Create reusable prompt recipes and launch an observable agent session for each run." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => record('GET', '/agent-cookbook', 'Cookbook refreshed')} data-testid="cookbook-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="cookbook-new"><Icon name="plus" size={14} />New Recipe</button></>}>
    <div className="tool-list">{items.map((recipe) => <article className="recipe-row" key={recipe.id} data-testid={`recipe-${recipe.id}`}><span className="tool-icon"><Icon name="book" /></span><span><strong>{recipe.title}</strong><p>{recipe.description}</p><small>{recipe.steps.length} steps · {recipe.status}{recipe.sessionId ? ` · ${recipe.sessionId}` : ''}</small></span><button className="primary-button compact" type="button" onClick={() => { const sessionId = createSession({ name: recipe.title }); updateSession(sessionId, { status: 'working' }); setItems((current) => current.map((item) => item.id === recipe.id ? { ...item, status: 'Running', sessionId } : item)); record('POST', `/agent-cookbook/${recipe.id}/run`, `Recipe started session ${sessionId}`); }} data-testid={`cookbook-run-${recipe.id}`}><Icon name="resume" size={13} />Run recipe</button><button className="icon-button small" type="button" aria-label={`Delete ${recipe.title}`} onClick={() => setDeleting(recipe)} data-testid={`cookbook-delete-${recipe.id}`}><Icon name="delete" size={14} /></button></article>)}</div>
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title="New Recipe" description="Steps are serialized as the shipping stepsJson array." testId="cookbook-editor"><form className="form-grid" onSubmit={save}><label className="field span-2">Title<input name="title" required data-autofocus /></label><label className="field span-2">Description<input name="description" /></label><label className="field span-2">Steps (one per line)<textarea name="steps" required rows={6} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="cookbook-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete Recipe" description={deleting ? `Delete “${deleting.title}”? This cannot be undone.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (!deleting) return; setItems((current) => current.filter((item) => item.id !== deleting.id)); record('DELETE', `/agent-cookbook/${deleting.id}`, 'Recipe deleted'); setDeleting(null); }} testId="cookbook-delete-dialog" />
  </ToolFrame>;
}

// Live cookbook — apps/web/src/gateway/cookbook.ts's CookbookRecipe is the canonical
// GET/POST/PATCH /agent-cookbook row (stepsJson stays a JSON string end-to-end, never
// re-parsed into local array state, so PATCH round-trips the exact bytes the server persisted).
// Running a recipe returns a real sessionId (agentCookbookController.ts:162); this fetches that
// session before navigating so a fabricated/foreign id can never pass as "opened".
function LiveCookbookTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [items, setItems] = useState<CookbookRecipe[]>([]);
  const [editing, setEditing] = useState<'new' | null>(null);
  const [deleting, setDeleting] = useState<CookbookRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-cookbook', detail: 'Loading cookbook recipes' });

  const load = async () => {
    setError(null);
    try {
      const next = await gateway.domains.cookbook!.list();
      setItems(next);
      setTrace({ method: 'GET', route: '/agent-cookbook', detail: `${next.length} recipes loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Cookbook failed to load'); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const steps = String(data.get('steps')).split('\n').map((value) => value.trim()).filter(Boolean);
    try {
      await gateway.domains.cookbook!.create({ title: String(data.get('title')), description: String(data.get('description') || '') || null, stepsJson: JSON.stringify(steps) });
      setTrace({ method: 'POST', route: '/agent-cookbook', detail: 'Recipe created with {title,description,stepsJson}' });
      await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Recipe save failed'); }
    setEditing(null);
  };

  const run = async (recipe: CookbookRecipe) => {
    try {
      const result = await gateway.domains.cookbook!.run(recipe.id);
      setTrace({ method: 'POST', route: `/agent-cookbook/${recipe.id}/run`, detail: `Recipe dispatched session ${result.sessionId}` });
      const session = await gateway.domains.cookbook!.session(result.sessionId);
      setTrace({ method: 'GET', route: `/agent-sessions/${session.id}`, detail: 'Opened the recipe’s owned session' });
      navigate('/agents');
    } catch (err) { notify(err instanceof Error ? err.message : 'Recipe run failed'); }
  };

  const remove = async (recipe: CookbookRecipe) => {
    try {
      await gateway.domains.cookbook!.remove(recipe.id);
      setItems((current) => current.filter((item) => item.id !== recipe.id));
      setTrace({ method: 'DELETE', route: `/agent-cookbook/${recipe.id}`, detail: 'Recipe deleted' });
    } catch (err) { notify(err instanceof Error ? err.message : 'Recipe delete failed'); }
    setDeleting(null);
  };

  return <ToolFrame slug="cookbook" title="Cookbook" description="Create reusable prompt recipes and launch an observable agent session for each run." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="cookbook-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => setEditing('new')} data-testid="cookbook-new"><Icon name="plus" size={14} />New Recipe</button></>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="cookbook-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {!error && items.length === 0 && <EmptyState title="Your cookbook is empty">Create a recipe to turn a proven sequence into a repeatable agent run.</EmptyState>}
    <div className="tool-list">{items.map((recipe) => {
      const steps = parseJsonArray<unknown>(recipe.stepsJson);
      return <article className="recipe-row" key={recipe.id} data-testid={`recipe-${recipe.id}`}><span className="tool-icon"><Icon name="book" /></span><span><strong>{recipe.title}</strong><p>{recipe.description}</p><small>{steps.length} steps{recipe.boundConfigId ? ` · bound to ${recipe.boundConfigId}` : ''}</small></span><button className="primary-button compact" type="button" onClick={() => void run(recipe)} data-testid={`cookbook-run-${recipe.id}`}><Icon name="resume" size={13} />Run recipe</button><button className="icon-button small" type="button" aria-label={`Delete ${recipe.title}`} onClick={() => setDeleting(recipe)} data-testid={`cookbook-delete-${recipe.id}`}><Icon name="delete" size={14} /></button></article>;
    })}</div>
    <FocusDialog open={Boolean(editing)} onClose={() => setEditing(null)} title="New Recipe" description="Steps are serialized as the shipping stepsJson array." testId="cookbook-editor"><form className="form-grid" onSubmit={(event) => void save(event)}><label className="field span-2">Title<input name="title" required data-autofocus /></label><label className="field span-2">Description<input name="description" /></label><label className="field span-2">Steps (one per line)<textarea name="steps" required rows={6} /></label><footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="cookbook-save">Save</button></footer></form></FocusDialog>
    <ConfirmDialog open={Boolean(deleting)} title="Delete Recipe" description={deleting ? `Delete “${deleting.title}”? This cannot be undone.` : ''} confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); }} testId="cookbook-delete-dialog" />
  </ToolFrame>;
}

type Proposal = { id: string; title: string; kind: string; risk: string; rationale: string; evidence: string; status: 'proposed' | 'approved' | 'rejected'; expanded?: boolean };
// post-m1-phase-5 c2b: the pending human-approval boundary (apps/api_server/src/controllers/agent_approvals_controller.ts:118-186)
// is a single shared list — Review Queue must read it live, the same GET /agent-approvals the
// originating transcript reads, never the seeded org-optimizer proposal fixtures below.
const reviewStatuses = ['proposed', 'sandbox-running', 'sandbox-vetted', 'pending', 'approved', 'rejected', 'applied', 'measuring', 'active', 'reverted', 'failed'];
const appliedStatuses = new Set(['applied', 'measuring', 'active', 'reverted']);

function ToolSafetyDetails({ proposal }: { proposal: OrgProposal }) {
  const safety = proposal.toolSafety;
  if (!safety || safety.state !== 'ready') return <p className="tool-notice" role="status">Approval unavailable: tool safety projection is {safety?.state ?? 'missing'}.</p>;
  return <section className="tool-safety-summary" aria-label="Tool safety summary"><h3>Tool safety review</h3><dl><div><dt>Verdict</dt><dd>{safety.verdict}</dd></div><div><dt>Tool</dt><dd>{safety.tool?.name} · {safety.tool?.packageSource}</dd></div><div><dt>Forbidden paths</dt><dd>{safety.forbiddenPathViolations?.map((entry) => `${entry.label} (${entry.count})`).join(', ') || 'None'}</dd></div><div><dt>Network hosts</dt><dd>{safety.networkCalls?.map((entry) => `${entry.host} (${entry.count})`).join(', ') || 'None'}</dd></div><div><dt>Workspace writes</dt><dd>{safety.workspaceWriteCount}</dd></div><div><dt>Credential attempts</dt><dd>{safety.credentialAccessAttemptsCount}</dd></div><div><dt>Scenarios</dt><dd>{safety.scenarioAttemptsCount}</dd></div><div><dt>Duration</dt><dd>{safety.sandboxDurationMs} ms</dd></div><div><dt>Reason</dt><dd>{safety.reason ?? 'None'}</dd></div></dl></section>;
}

function LiveReviewTool() {
  const gateway = useGateway();
  const [items, setItems] = useState<OrgProposal[]>([]); const [status, setStatus] = useState('proposed');
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ proposal: OrgProposal; action: 'approve' | 'conditional' | 'reject' | 'revert' } | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-org-proposals?status=proposed', detail: 'Loading organization proposals' });
  const load = async (nextStatus = status) => { setLoading(true); setError(null); try { const next = await gateway.domains.orgProposals!.list(nextStatus); setItems(next); setTrace({ method: 'GET', route: `/agent-org-proposals?status=${encodeURIComponent(nextStatus)}`, detail: `${next.length} proposals loaded` }); } catch (err) { setError(err instanceof Error ? err.message : 'Proposal list failed'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const approveable = (proposal: OrgProposal) => proposal.status === 'proposed' || proposal.status === 'failed';
  const canApprove = (proposal: OrgProposal) => proposal.kind !== 'tool-install' || proposal.toolSafety?.state === 'ready' && ['safe', 'conditional'].includes(proposal.toolSafety.verdict);
  const mutate = async () => { if (!confirmation) return; const { proposal, action } = confirmation; setConfirmation(null); try { if (action === 'approve' || action === 'conditional') await gateway.domains.orgProposals!.approve(proposal.id, action === 'conditional'); if (action === 'reject') await gateway.domains.orgProposals!.reject(proposal.id); if (action === 'revert') await gateway.domains.orgProposals!.revert(proposal.id); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Proposal update failed'); await load(); } };
  const title = confirmation?.action === 'conditional' ? 'Approve conditional tool install?' : confirmation?.action === 'approve' ? 'Approve proposal?' : confirmation?.action === 'reject' ? 'Reject proposal?' : 'Revert applied change?';
  const description = confirmation?.action === 'conditional' ? 'This tool install is conditional. Confirm that you explicitly approve the closed safety review above.' : 'The server remains authoritative. The queue will refresh after this decision.';
  return <ToolFrame slug="review" title="Review Queue" description="Review organization proposals and their applied-change history." trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="review-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    <div className="tool-filterbar"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)} data-testid="review-filter">{reviewStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><span>{items.length} proposals</span></div>
    {appliedStatuses.has(status) && <p className="tool-notice"><strong>Applied Changes</strong> · deployment history remains separate from measured outcome.</p>}
    {loading && <p role="status">Loading proposals…</p>}
    {error && <section className="tool-state-panel error" role="alert" data-testid="review-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    <div className="proposal-grid" data-testid="review-list">{items.map((proposal) => <article className="proposal-card" key={proposal.id} data-testid={`proposal-${proposal.id}`}><header><span className="kind-badge">{proposal.kind}</span><span className={`risk-badge ${proposal.risk}`}>{proposal.risk} risk</span></header><h2>{proposal.title}</h2><p>{proposal.rationale ?? 'No rationale provided.'}</p><dl className="proposal-statuses"><div><dt>Deployment</dt><dd>{`Deployment: ${proposal.status}`}</dd></div><div><dt>Outcome</dt><dd>{`Outcome: ${proposal.outcomeStatus}`}</dd></div><div><dt>Created</dt><dd>{proposal.createdAt ?? 'Unknown'}</dd></div><div><dt>Updated</dt><dd>{proposal.updatedAt ?? 'Unknown'}</dd></div></dl>{proposal.experimentSummary?.safeExperimentSummary && <p className="tool-notice">Experiment: {proposal.experimentSummary.safeExperimentSummary}</p>}{proposal.kind === 'tool-install' && <ToolSafetyDetails proposal={proposal} />}<footer>{approveable(proposal) && <><button className="secondary-button" type="button" onClick={() => setConfirmation({ proposal, action: 'reject' })} data-testid={`proposal-reject-${proposal.id}`}>Reject</button><button className="primary-button" type="button" disabled={!canApprove(proposal)} title={!canApprove(proposal) ? 'A safe or conditionally safe closed tool-safety projection is required.' : undefined} onClick={() => setConfirmation({ proposal, action: proposal.kind === 'tool-install' && proposal.toolSafety?.verdict === 'conditional' ? 'conditional' : 'approve' })} data-testid={`proposal-approve-${proposal.id}`}>Approve</button></>}{proposal.status === 'active' && <button className="danger-button" type="button" onClick={() => setConfirmation({ proposal, action: 'revert' })} data-testid={`proposal-revert-${proposal.id}`}>Revert</button>}</footer></article>)}</div>
    {!loading && items.length === 0 && !error && <EmptyState title="Nothing waiting for review">Choose a proposal status to inspect its review or applied-change history.</EmptyState>}
    <FocusDialog open={Boolean(confirmation)} onClose={() => setConfirmation(null)} title={title} description={description} testId={confirmation?.action === 'conditional' ? 'proposal-conditional-dialog' : confirmation?.action === 'revert' ? 'proposal-revert-dialog' : 'proposal-confirm-dialog'}><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirmation(null)}>Cancel</button><button className={confirmation?.action === 'revert' ? 'danger-button' : 'primary-button'} type="button" onClick={() => void mutate()} data-testid={confirmation?.action === 'conditional' ? 'proposal-conditional-confirm' : confirmation?.action === 'revert' ? 'proposal-revert-confirm' : 'proposal-confirm'}>Confirm</button></div></FocusDialog>
  </ToolFrame>;
}

function FixtureReviewTool() {
  const { notify } = useFixtures(); const [items, setItems] = useState<Proposal[]>([{ id: 'proposal-research-agent', title: 'Adopt research-librarian profile', kind: 'external_adoption', risk: 'medium', rationale: 'Repeated research runs benefit from explicit citation constraints.', evidence: 'signal: 7 verified runs · post score 84', status: 'proposed' }, { id: 'proposal-review-skill', title: 'Promote verification skill', kind: 'skill_change', risk: 'low', rationale: 'The measured revision reduced unverified handoffs.', evidence: 'baseline 60 · post 82 · decision keep', status: 'proposed' }]); const [status, setStatus] = useState('proposed'); const [rejecting, setRejecting] = useState<Proposal | null>(null); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-org-proposals?status=proposed', detail: 'Proposals waiting for human review loaded' }); const visible = items.filter((item) => item.status === status); const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  return <ToolFrame slug="review" title="Review Queue" description="Human-gated organization optimizer proposals remain inert until a person approves or rejects them." trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => record('GET', `/agent-org-proposals?status=${status}`, 'Review queue refreshed')} data-testid="review-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    <div className="tool-filterbar"><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setTrace({ method: 'GET', route: `/agent-org-proposals?status=${event.target.value}`, detail: 'Proposal status filter changed' }); }} data-testid="review-filter"><option value="proposed">Proposed</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><span>{visible.length} proposals</span></div>
    <div className="proposal-grid">{visible.map((proposal) => <article className="proposal-card" key={proposal.id} data-testid={`proposal-${proposal.id}`}><header><span className="kind-badge">{proposal.kind}</span><span className={`risk-badge ${proposal.risk}`}>{proposal.risk} risk</span></header><h2>{proposal.title}</h2><p>{proposal.rationale}</p><button className="text-button" type="button" aria-expanded={Boolean(proposal.expanded)} onClick={() => setItems((current) => current.map((item) => item.id === proposal.id ? { ...item, expanded: !item.expanded } : item))} data-testid={`proposal-expand-${proposal.id}`}>{proposal.expanded ? 'Hide evidence' : 'Show evidence'}</button>{proposal.expanded && <pre>{proposal.evidence}</pre>}<footer><button className="secondary-button" type="button" onClick={() => setRejecting(proposal)} data-testid={`proposal-reject-${proposal.id}`}>Reject</button><button className="primary-button" type="button" onClick={() => { setItems((current) => current.map((item) => item.id === proposal.id ? { ...item, status: 'approved' } : item)); record('POST', `/agent-org-proposals/${proposal.id}/approve`, 'Proposal approved by the human gate'); }} data-testid={`proposal-approve-${proposal.id}`}>Approve</button></footer></article>)}</div>{visible.length === 0 && <EmptyState title="Nothing waiting for review">Choose another status to inspect decided proposals.</EmptyState>}
    <ConfirmDialog open={Boolean(rejecting)} title="Reject proposal?" description={rejecting ? `“${rejecting.title}” will be rejected and will not be re-proposed.` : ''} confirmLabel="Reject" onClose={() => setRejecting(null)} onConfirm={() => { if (!rejecting) return; setItems((current) => current.map((item) => item.id === rejecting.id ? { ...item, status: 'rejected' } : item)); record('POST', `/agent-org-proposals/${rejecting.id}/reject`, 'Proposal rejected by the human gate'); setRejecting(null); }} testId="proposal-reject-dialog" />
  </ToolFrame>;
}

function ReportCardTool() {
  const { notify } = useFixtures(); const [days, setDays] = useState(30); const [selected, setSelected] = useState('coordinator'); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agents/run-quality?windowDays=30', detail: 'Run-quality rollup loaded' }); const agents = [{ id: 'coordinator', label: 'Rhythm Coordinator', runs: 18, completion: 89, waste: 7, corrections: 0.3, mistakes: ['Missed a fallback owner · 2×'] }, { id: 'builder', label: 'Implementation Partner', runs: 12, completion: 83, waste: 11, corrections: 0.5, mistakes: [] }]; const agent = agents.find((item) => item.id === selected) ?? agents[0]; const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  return <ToolFrame slug="report-card" title="Agent Report Card" description={`How each agent has been doing over the last ${days} days - separate from how much they cost.`} trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => record('GET', `/agents/run-quality?windowDays=${days}`, 'Report card refreshed')} data-testid="report-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    <div className="tool-filterbar"><label>Time window<select value={days} onChange={(event) => { const next = Number(event.target.value); setDays(next); setTrace({ method: 'GET', route: `/agents/run-quality?windowDays=${next}`, detail: 'Run-quality time window changed' }); }} data-testid="report-window"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label><span>Fixture clock · Aug 12, 2026</span></div><div className="tool-split"><aside className="tool-rail">{agents.map((item) => <button type="button" className={item.id === selected ? 'selected' : ''} key={item.id} onClick={() => setSelected(item.id)} data-testid={`report-agent-${item.id}`}><strong>{item.label}</strong><small>{item.runs} runs</small></button>)}</aside><section className="tool-detail report-detail"><header><span className="eyebrow">{agent.runs} runs</span><h2>{agent.label}</h2></header><div className="metric-grid"><article><small>Completion</small><strong>{agent.completion}%</strong><p>Finished the job {agent.completion}% of the time.</p></article><article><small>Wasted usage</small><strong>{agent.waste}%</strong><p>Usage spent on runs that did not pan out.</p></article><article><small>Corrections</small><strong>{agent.corrections}</strong><p>Average redirects per run.</p></article></div><section className="session-quality"><h3>Session-level detail</h3><button type="button" onClick={() => record('GET', `/agents/run-quality?windowDays=${days}`, 'Session evidence expanded')}><span className="status-dot working" /><span><strong>Sunday service handoff</strong><small>Completed · verified evidence · 1 correction</small></span><Icon name="chevronRight" size={14} /></button>{agent.mistakes.length > 0 && <div className="quality-warning"><strong>Keeps making the same mistake</strong>{agent.mistakes.map((item) => <span key={item}>{item}</span>)}</div>}</section></section></div>
  </ToolFrame>;
}

// Live report card — apps/web/src/gateway/run-quality.ts's RunQualityRollup is the canonical
// GET /agents/run-quality shape. `notEnoughData` must suppress the rate entirely (never fall back
// to a fixture-style fixed percentage like the old 89%/83% scorecards this criterion regressed on).
function formatRate(rate: number | null, notEnoughData: boolean): string {
  if (notEnoughData || rate === null) return 'Not scored yet';
  return `${Math.round(rate * 100)}%`;
}

function LiveReportCardTool() {
  const gateway = useGateway();
  const [days, setDays] = useState(30);
  const [agents, setAgents] = useState<AgentRunQuality[]>([]);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: `/agents/run-quality?windowDays=${days}`, detail: 'Loading run-quality rollup' });
  const selected = agents.find((agent) => agent.agentKind === selectedKind) ?? agents[0] ?? null;

  const load = async (windowDays: number) => {
    setError(null);
    try {
      const rollup = await gateway.domains.runQuality!.rollup(windowDays);
      setAgents(rollup.agents);
      setSelectedKind((current) => (current && rollup.agents.some((agent) => agent.agentKind === current) ? current : (rollup.agents[0]?.agentKind ?? null)));
      setTrace({ method: 'GET', route: `/agents/run-quality?windowDays=${windowDays}`, detail: `${rollup.agents.length} agents scored` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Run-quality rollup failed'); }
  };
  useEffect(() => { void load(days); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <ToolFrame slug="report-card" title="Agent Report Card" description={`How each agent has been doing over the last ${days} days - separate from how much they cost.`} trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => void load(days)} data-testid="report-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="report-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    <div className="tool-filterbar"><label>Time window<select value={days} onChange={(event) => { const next = Number(event.target.value); setDays(next); void load(next); }} data-testid="report-window"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label></div>
    {!error && agents.length === 0 && <EmptyState title="No scored runs yet">Quality trends appear after an agent finishes a run with enough evidence to score.</EmptyState>}
    {selected && <div className="tool-split">
      <aside className="tool-rail">{agents.map((agent) => <button type="button" className={agent.agentKind === selected.agentKind ? 'selected' : ''} key={agent.agentKind} onClick={() => setSelectedKind(agent.agentKind)} data-testid={`report-agent-${agent.agentKind}`}><strong>{agent.agentLabel ?? agent.agentKind}</strong><small>{agent.totalRuns} runs</small></button>)}</aside>
      <section className="tool-detail report-detail">
        <header><span className="eyebrow">{selected.totalRuns} runs</span><h2>{selected.agentLabel ?? selected.agentKind}</h2>{selected.notEnoughData && <p role="status">Not enough data to score this agent yet.</p>}</header>
        <div className="metric-grid">
          <article><small>Completion</small><strong>{formatRate(selected.completionRate, selected.notEnoughData)}</strong><p>Finished the job {formatRate(selected.completionRate, selected.notEnoughData).toLowerCase()} of the time.</p></article>
          <article><small>Wasted usage</small><strong>{formatRate(selected.wastedTokenRate, selected.notEnoughData)}</strong><p>Usage spent on runs that did not pan out.</p></article>
          <article><small>Corrections</small><strong>{selected.notEnoughData || selected.averageCorrectionsPerRun === null ? 'Not scored yet' : selected.averageCorrectionsPerRun}</strong><p>Average redirects per run.</p></article>
        </div>
        <section className="session-quality">
          <h3>Run evidence</h3>
          <p>{selected.unmeasuredRuns} unmeasured · {selected.inProgressRuns} in progress · {selected.completedRuns} completed · {selected.escalatedRuns} escalated · {selected.totalTokens} tokens ({selected.wastedTokens} wasted) · {selected.totalUserCorrections} corrections</p>
          {selected.repeatedMistakes.length > 0 && <div className="quality-warning"><strong>Keeps making the same mistake</strong>{selected.repeatedMistakes.map((item) => <span key={item.mistake}>{item.mistake} · {item.count}×</span>)}</div>}
        </section>
      </section>
    </div>}
  </ToolFrame>;
}

type EmailSignal = { id: string; from: string; email: string; subject: string; snippet: string; unread: boolean; received: string };
function EmailTool() {
  const { notify, createSession, updateSession } = useFixtures(); const signals: EmailSignal[] = [{ id: 'email-handoff', from: 'Morgan Lee', email: 'morgan@example.org', subject: 'Sunday handoff owner', snippet: 'I can cover the livestream fallback if the run sheet is updated.', unread: true, received: 'Aug 12, 3:36 PM' }, { id: 'email-relay', from: 'Rhythm Ops', email: 'ops@example.org', subject: 'Relay recovery notes', snippet: 'The direct pairing check passed after reconnect.', unread: false, received: 'Aug 12, 2:18 PM' }]; const [selectedId, setSelectedId] = useState(signals[0].id); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/integrations/gmail-signals', detail: 'Authenticated Gmail signals loaded into fixture state' }); const selected = signals.find((item) => item.id === selectedId) ?? signals[0]; const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const launch = () => { const id = createSession({ name: 'Email Assistant', cwd: '/workspace/rhythm' }); updateSession(id, { status: 'resumable', messages: [{ id: 'msg-email-context', role: 'system', createdAt: FIXED_NOW, blocks: [{ id: 'block-email-context', kind: 'markdown', content: `Seeded Gmail context: ${selected.from} - ${selected.subject}\n${selected.snippet}` }] }] }); record('POST', '/agent-sessions', 'Email Assistant session created with mcpRole email-assistant and seeded signal context'); navigate('/agents'); };
  return <ToolFrame slug="email" title="Email" description="Review Gmail signals and launch a focused Email Assistant session with the selected signal as context." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => record('GET', '/integrations/gmail-signals', 'Gmail signals refreshed')} data-testid="email-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={launch} data-testid="email-launch"><Icon name="mail" size={14} />Launch email assistant</button></>}>
    <div className="tool-split"><aside className="tool-rail signal-rail">{signals.map((signal) => <button type="button" className={signal.id === selected.id ? 'selected' : ''} key={signal.id} onClick={() => setSelectedId(signal.id)} data-testid={`email-signal-${signal.id}`}><span className={`unread-dot ${signal.unread ? 'active' : ''}`} /><strong>{signal.from}</strong><small>{signal.subject}</small></button>)}</aside><article className="tool-detail email-detail"><span className="eyebrow">{selected.received}</span><h2>{selected.subject}</h2><p>From {selected.from} &lt;{selected.email}&gt;</p><div className="email-body">{selected.snippet}</div><div className="tool-notice"><Icon name="mail" size={15} /><span>This surface is read-only. Replies happen through the launched agent session.</span></div></article></div>
  </ToolFrame>;
}

// Live Gallery — apps/web/src/gateway/designs.ts's AgentDesign mirrors
// apps/api_server/src/repositories/agent_designs_repository.ts:5-16 (publicAgentDesign, filePath
// stripped server-side). "Open deliverable" fetches the actual artifact bytes/text
// (GET /agent-designs/:id/artifact) instead of just recording a fixture trace, and "Launch Creative
// Media" seeds the new session from this design's own canonical `id` in the POST /agent-sessions
// body — never a locally re-typed title/type/project summary.
const imageArtifactTypes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const videoArtifactTypes = new Set(['mp4', 'webm', 'mov']);

function DesignPreview({ design }: { design: AgentDesign }) {
  const [failed, setFailed] = useState(false);
  const type = design.artifactType?.toLowerCase() ?? '';
  const previewUrl = design.thumbnailUrl ?? ((imageArtifactTypes.has(type) || videoArtifactTypes.has(type)) ? design.artifactUrl : null);
  if (!failed && videoArtifactTypes.has(type) && design.artifactUrl) return <><video src={design.artifactUrl} poster={design.thumbnailUrl ?? undefined} muted preload="metadata" aria-hidden="true" onError={() => setFailed(true)} /><span>{design.artifactType}</span></>;
  if (!failed && previewUrl) return <><img src={previewUrl} alt="" onError={() => setFailed(true)} /><span>{design.artifactType ?? 'unknown'}</span></>;
  // ponytail: the API's thumbnailUrl is nullable, so rows without a real asset stay honest.
  return <><Icon name={design.artifactType === 'html' ? 'artifact' : 'gallery'} size={28} /><span>{design.artifactType ?? 'unknown'}</span></>;
}

function LiveGalleryTool() {
  const gateway = useGateway();
  const { notify } = useFixtures();
  const [designs, setDesigns] = useState<AgentDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-designs', detail: 'Loading creative designs' });
  const selected = designs.find((design) => design.id === selectedId) ?? designs[0] ?? null;

  const load = async () => {
    setError(null);
    try {
      const next = await gateway.domains.designs!.list();
      setDesigns(next);
      setSelectedId((current) => (current && next.some((design) => design.id === current) ? current : (next[0]?.id ?? null)));
      setTrace({ method: 'GET', route: '/agent-designs', detail: `${next.length} designs loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Creative designs failed to load'); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (design: AgentDesign) => {
    try {
      await gateway.domains.designs!.artifact(design);
      setTrace({ method: 'GET', route: design.artifactUrl ?? `/agent-designs/${design.id}/artifact`, detail: `Opened ${design.title ?? design.id} deliverable` });
    } catch (err) { notify(err instanceof Error ? err.message : 'Deliverable could not be opened'); }
  };

  const launch = async () => {
    if (!selected) return;
    try {
      const session = await gateway.domains.designs!.launch(selected.id);
      setTrace({ method: 'POST', route: '/agent-sessions', detail: `Creative Media session ${session.id} created seeded from design ${selected.id}` });
      navigate('/agents');
    } catch (err) { notify(err instanceof Error ? err.message : 'Creative Media session could not be launched'); }
  };

  return <ToolFrame slug="gallery" title="Creative Media" description="Browse agent designs and launch a Creative Media session from the selected artifact context." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="gallery-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={() => void launch()} data-testid="gallery-launch"><Icon name="gallery" size={14} />Launch Creative Media</button></>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="gallery-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {!error && designs.length === 0 && <EmptyState title="No creative artifacts yet">Generated images, documents, and interactive artifacts will collect here.</EmptyState>}
    {selected && <section className="gallery-detail" aria-live="polite" data-testid="gallery-detail"><span className="tool-icon"><Icon name={selected.artifactType === 'html' ? 'artifact' : 'gallery'} /></span><div><span className="eyebrow">Selected artifact</span><h2>{selected.title ?? selected.id}</h2><p>{selected.artifactType ?? 'unknown'} · {selected.provider ?? 'unknown provider'}</p></div></section>}
    <div className="design-grid" aria-label="Creative Media artifacts">{designs.map((design) => <article className={design.id === selected?.id ? 'selected' : ''} key={design.id} data-testid={`design-${design.id}`}>
      <button className="design-preview" type="button" onClick={() => setSelectedId(design.id)} aria-label={`Select ${design.title ?? design.id}`}><DesignPreview design={design} /></button>
      <h2>{design.title ?? design.id}</h2>
      <p>{design.provider ?? 'unknown provider'}</p>
      <footer>
        <button className="text-button" type="button" onClick={() => void open(design)} data-testid={`gallery-open-${design.id}`}>Open deliverable</button>
        {design.projectUrl && <button className="text-button" type="button" onClick={() => { setTrace({ method: 'LOCAL', route: design.projectUrl!, detail: 'Opened project preview' }); navigate('/projects'); }} data-testid={`gallery-project-${design.id}`}>Open project</button>}
      </footer>
    </article>)}</div>
  </ToolFrame>;
}

type Design = { id: string; title: string; provider: string; type: string; project: string };
function GalleryTool() {
  const { notify, createSession, updateSession } = useFixtures(); const designs: Design[] = [{ id: 'design-service-slide', title: 'Sunday service announcement', provider: 'local artifact', type: 'HTML', project: 'Ministry operations' }, { id: 'design-relay-card', title: 'Relay status card', provider: 'creative-media', type: 'PNG', project: 'Synology relay' }, { id: 'design-handoff', title: 'Agent handoff checklist', provider: 'local artifact', type: 'PDF', project: 'Rhythm desktop' }]; const [selectedId, setSelectedId] = useState(designs[0].id); const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-designs', detail: 'Creative Media artifacts loaded' }); const selected = designs.find((item) => item.id === selectedId) ?? designs[0]; const record = (method: string, route: string, detail: string) => { setTrace({ method, route, detail }); notify(detail); };
  const launch = () => { const id = createSession({ name: 'Graphic Designer', cwd: '/workspace/rhythm' }); updateSession(id, { status: 'resumable', messages: [{ id: 'msg-gallery-context', role: 'system', createdAt: FIXED_NOW, blocks: [{ id: 'block-gallery-context', kind: 'markdown', content: `Seeded Creative Media context: ${selected.title} · ${selected.type} · ${selected.project}` }] }] }); record('POST', '/agent-sessions', 'Creative Media session created with agentId creative-media and seeded artifact context'); navigate('/agents'); };
  return <ToolFrame slug="gallery" title="Creative Media" description="Browse agent designs and launch a Creative Media session from the selected artifact context." trace={trace} actions={<><button className="secondary-button compact" type="button" onClick={() => record('GET', '/agent-designs', 'Design gallery refreshed')} data-testid="gallery-refresh"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={launch} data-testid="gallery-launch"><Icon name="gallery" size={14} />Launch Creative Media</button></>}>
    <section className="gallery-detail" aria-live="polite" data-testid="gallery-detail"><span className="tool-icon"><Icon name={selected.type === 'HTML' ? 'artifact' : selected.type === 'PNG' ? 'gallery' : 'file'} /></span><div><span className="eyebrow">Selected artifact</span><h2>{selected.title}</h2><p>{selected.type} · {selected.provider} · {selected.project}</p></div></section><div className="design-grid" aria-label="Creative Media artifacts">{designs.map((design) => <article className={design.id === selected.id ? 'selected' : ''} key={design.id} data-testid={`design-${design.id}`}><button className="design-preview" type="button" onClick={() => setSelectedId(design.id)} aria-label={`Select ${design.title}`}><Icon name={design.type === 'HTML' ? 'artifact' : design.type === 'PNG' ? 'gallery' : 'file'} size={28} /><span>{design.type}</span></button><h2>{design.title}</h2><p>{design.provider} · {design.project}</p><footer><button className="text-button" type="button" onClick={() => record('GET', `/agent-designs/${design.id}/artifact`, `Opened ${design.title} deliverable`)} data-testid={`gallery-open-${design.id}`}>Open deliverable</button><button className="text-button" type="button" onClick={() => { record('LOCAL', `#/projects/${encodeURIComponent(design.project)}`, `Opened ${design.project} project preview`); navigate('/projects'); }} data-testid={`gallery-project-${design.id}`}>Open project</button></footer></article>)}</div>
  </ToolFrame>;
}

function SettingsTool() {
  const [trace, setTrace] = useState<Trace>({ method: 'LOCAL', route: 'fixture://agent-settings', detail: 'Local runtime defaults loaded' });
  return <ToolFrame slug="agent-settings" title="Agent settings" description="Execution defaults for local Agents sessions." trace={trace}><div className="tool-list"><button className="tool-row-main settings-row" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/connection', detail: 'Desktop endpoint is local' })}><span><strong>Desktop endpoint</strong><small>Fixture preview · not connected</small></span><Icon name="chevronRight" size={14} /></button><button className="tool-row-main settings-row" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/offline-buffer', detail: 'Offline buffering is local UI state until reconnect' })}><span><strong>Offline buffering</strong><small>Local only · no remote queue</small></span><Icon name="chevronRight" size={14} /></button></div></ToolFrame>;
}

function AutoPromotionSettings() {
  const gateway = useGateway(); const [state, setState] = useState<Awaited<ReturnType<NonNullable<typeof gateway.domains.autoPromotion>['get']>> | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false); const [submitting, setSubmitting] = useState(false);
  const load = async () => { setLoading(true); setError(''); try { setState(await gateway.domains.autoPromotion!.get()); } catch (err) { setError(err instanceof Error ? err.message : 'Auto-promotion state could not be loaded'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const enabled = state?.state.autoPromotionEnabled ?? false; const canEnable = Boolean(state?.availability && state.state.autoPromotionEligible && state.state.totalRegressions === 0);
  const submit = async () => { setConfirm(false); setSubmitting(true); setError(''); try { await gateway.domains.autoPromotion!.setEnabled(!enabled); } catch (err) { setError(err instanceof Error ? err.message : 'Auto-promotion update failed'); } finally { setSubmitting(false); await load(); } };
  return <section className="auto-promotion-card" aria-label="Auto-promotion" data-testid="auto-promotion"><header><div><h2>Auto-promotion</h2><p>Verified changes may be promoted automatically only when the organization is eligible.</p></div><span className={`kind-badge ${enabled ? 'active' : ''}`}>{enabled ? 'Enabled' : 'Disabled'}</span></header>{loading && <p role="status">Loading auto-promotion state…</p>}{error && <p role="alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Retry</button></p>}{state && <dl className="property-list"><div><dt>Availability</dt><dd>{state.availability ? 'Available' : 'Unavailable'}</dd></div><div><dt>Eligibility</dt><dd>{state.state.autoPromotionEligible ? 'Eligible' : 'Not eligible'}</dd></div><div><dt>Verified changes</dt><dd>{state.state.totalVerified} / {state.state.trustThreshold}</dd></div><div><dt>Regressions</dt><dd>{state.state.totalRegressions}</dd></div>{state.state.enabledAt && <div><dt>Enabled</dt><dd>{state.state.enabledAt}</dd></div>}</dl>}<footer><button className={enabled ? 'danger-button' : 'primary-button'} type="button" disabled={submitting || loading || !enabled && !canEnable} title={!enabled && !canEnable ? 'Requires availability, eligibility, and zero regressions.' : undefined} onClick={() => setConfirm(true)} data-testid="auto-promotion-toggle">{enabled ? 'Disable' : 'Enable'}</button></footer><FocusDialog open={confirm} onClose={() => setConfirm(false)} title={enabled ? 'Disable auto-promotion?' : 'Enable auto-promotion?'} description={enabled ? 'Disable is an emergency stop. The server requires your explicit acknowledgement.' : 'Verified changes may be promoted automatically when eligibility is maintained.'} testId="auto-promotion-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(false)} data-testid="auto-promotion-cancel">Cancel</button><button className={enabled ? 'danger-button' : 'primary-button'} type="button" onClick={() => void submit()} data-testid="auto-promotion-confirm">Confirm</button></div></FocusDialog></section>;
}

function LiveSettingsTool() {
  const gateway = useGateway();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-configs', detail: 'Loading live agent configuration' });

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const next = await gateway.domains.sessions!.profiles();
      setProfiles(next);
      setTrace({ method: 'GET', route: '/agent-configs', detail: `${next.length} agent profiles loaded` });
    } catch (err) { setError(err instanceof Error ? err.message : 'Agent settings failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <ToolFrame slug="agent-settings" title="Agent settings" description="Live execution defaults from the configured agent profiles." trace={trace} actions={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>}>
    {error && <section className="tool-state-panel error" role="alert" data-testid="agent-settings-error"><span className="tool-state-code">Error</span><p>{error}</p></section>}
    {loading && <p role="status">Loading agent settings…</p>}
    {!loading && !error && profiles.length === 0 && <EmptyState title="No agent profiles configured">Create an agent profile before starting a configured session.</EmptyState>}
    <div className="tool-list">{profiles.map((profile) => <article className="tool-row settings-row" key={profile.id} data-testid={`agent-setting-${profile.id}`}><span className="profile-avatar" aria-label={`${profile.label} icon`}>{profileAvatarLabel(profile)}</span><span><strong>{profile.label}</strong><small>{profile.enabled ? 'Enabled' : 'Disabled'} · {profile.provider} · {profile.model}</small></span>{profile.isDefault && <span className="kind-badge">Default</span>}</article>)}</div>
    <AutoPromotionSettings />
  </ToolFrame>;
}

export function ToolWorkspace({ slug }: { slug: string }) {
  const { sessionGatewayMode } = useFixtures();
  const live = sessionGatewayMode === 'live';
  const tools: Record<string, ReactNode> = { brain: live ? <LiveBrainTool /> : <FixtureBrainTool />, 'deep-research': live ? <LiveResearchTool /> : <ResearchTool />, tasks: live ? <LiveSchedulesTool /> : <FixtureSchedulesTool />, webhooks: <WebhooksTool />, skills: live ? <LiveSkillsTool /> : <ManagedCatalog key="skills" kind="skills" />, playbooks: live ? <LivePlaybooksTool /> : <ManagedCatalog key="playbooks" kind="playbooks" />, cookbook: live ? <LiveCookbookTool /> : <CookbookTool />, review: live ? <LiveReviewTool /> : <FixtureReviewTool />, 'report-card': live ? <LiveReportCardTool /> : <ReportCardTool />, email: <EmailTool />, gallery: live ? <LiveGalleryTool /> : <GalleryTool />, 'agent-settings': live ? <LiveSettingsTool /> : <SettingsTool /> };
  return <div key={slug} className="tool-route-boundary">{tools[slug] ?? (live ? <LiveBrainTool /> : <FixtureBrainTool />)}</div>;
}
