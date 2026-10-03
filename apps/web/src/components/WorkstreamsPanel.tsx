import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Profile } from '../types';
import { useGateway } from '../gateway/context';
import type {
  Workstream,
  WorkstreamCheckpoint,
  WorkstreamEvidence,
  WorkstreamReference,
  WorkstreamStatus,
} from '../gateway/workstreams';
import './WorkstreamsPanel.css';

const ACTIVE_JOB_STATES = new Set(['queued', 'claimed', 'running', 'unknown']);
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'cancelled']);

function opaqueKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function checkpointFor(projectId: string, criteria: string, references: WorkstreamReference[]): WorkstreamCheckpoint {
  const rows = criteria.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    version: 1,
    criteria: (rows.length ? rows : ['criterion']).slice(0, 100).map((_, index) => ({
      id: `criterion-${index + 1}`,
      status: 'pending' as const,
    })),
    references,
    nextAction: { kind: 'review', scope: projectId },
  };
}

function parseReferences(value: string, projectId: string): WorkstreamReference[] {
  const rows = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (rows.length > 50) throw new Error('At most 50 metadata references may be attached.');
  return rows.map((row) => {
    const parts = row.split('@');
    if (parts.length !== 2 ||
        !(/^memory:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[0]) || /^dayflow:[A-Za-z0-9._:-]{1,118}$/.test(parts[0])) ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(parts[1])) {
      throw new Error('References use memory:<record-id>@sha256:<hash>. Dayflow metadata is typed but currently unavailable.');
    }
    return { sourceId: parts[0], expectedVersion: parts[1], scope: projectId, provenance: 'user_reference' };
  });
}

function compactTime(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'unavailable';
}

function numberAt(value: Record<string, unknown> | null, key: string): number | null {
  const result = value?.[key];
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
}

function recordText(value: Record<string, unknown> | null, key: string): string | null {
  const result = value?.[key];
  return typeof result === 'string' && result.length > 0 ? result : null;
}

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ');
}

export function WorkstreamsPanel({
  projectId,
  parentSessionId,
  profiles,
}: {
  projectId: string | null | undefined;
  parentSessionId: string | null | undefined;
  profiles: Profile[];
}) {
  const gateway = useGateway();
  const api = gateway.mode === 'live' ? gateway.domains.workstreams : undefined;
  const eligibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.enabled && profile.selectable && profile.isAgent !== false),
    [profiles],
  );
  const [views, setViews] = useState<WorkstreamStatus[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState('');
  const [maxWallTimeSeconds, setMaxWallTimeSeconds] = useState(300);
  const [maxTokens, setMaxTokens] = useState(20_000);
  const [commandKeys, setCommandKeys] = useState<Record<string, string>>({});
  const [evidenceByKey, setEvidenceByKey] = useState<Record<string, WorkstreamEvidence>>({});

  const load = useCallback(async () => {
    if (!api || !projectId) return;
    setLoading(true);
    setError('');
    try {
      const page = await api.list(projectId);
      setViews(page.items);
      setSelectedId((current) => page.items.some((item) => item.workstream.id === current)
        ? current
        : page.items[0]?.workstream.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Workstreams could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!targetProfileId && eligibleProfiles[0]) setTargetProfileId(eligibleProfiles[0].id);
    if (targetProfileId && !eligibleProfiles.some((profile) => profile.id === targetProfileId)) {
      setTargetProfileId(eligibleProfiles[0]?.id ?? '');
    }
  }, [eligibleProfiles, targetProfileId]);

  const selected = views.find((item) => item.workstream.id === selectedId) ?? null;
  const replace = (next: WorkstreamStatus) => {
    setViews((current) => {
      const existing = current.some((item) => item.workstream.id === next.workstream.id);
      return existing
        ? current.map((item) => item.workstream.id === next.workstream.id ? next : item)
        : [next, ...current];
    });
    setSelectedId(next.workstream.id);
    if (next.workstream.state === 'ready' && next.jobs.some((job) => TERMINAL_JOB_STATES.has(job.state))) {
      setCommandKeys((current) => {
        const { [next.workstream.id]: _discarded, ...rest } = current;
        return rest;
      });
    }
  };

  const mutate = async (operation: () => Promise<WorkstreamStatus>) => {
    setBusy(true);
    setError('');
    try {
      replace(await operation());
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Workstream action failed.');
    } finally {
      setBusy(false);
    }
  };

  const inspectEvidence = async (workstreamId: string, sourceId: string) => {
    if (!api || !projectId || busy) return;
    setBusy(true);
    setError('');
    try {
      const evidence = await api.inspectEvidence(projectId, workstreamId, sourceId);
      setEvidenceByKey((current) => ({ ...current, [`${workstreamId}:${sourceId}`]: evidence }));
    } catch (inspectionError) {
      setError(inspectionError instanceof Error ? inspectionError.message : 'Evidence could not be inspected.');
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!api || !projectId || busy) return;
    const data = new FormData(event.currentTarget);
    const goal = String(data.get('goal') ?? '').trim();
    const constraints = String(data.get('constraints') ?? '').trim();
    const criteria = String(data.get('criteria') ?? '').trim();
    if (!goal || !constraints || !criteria) { setError('Goal, constraints, and criteria are all required.'); return; }
    let references: WorkstreamReference[];
    try { references = parseReferences(String(data.get('references') ?? ''), projectId); }
    catch (referenceError) { setError(referenceError instanceof Error ? referenceError.message : 'References are invalid.'); return; }
    setBusy(true);
    setError('');
    try {
      const row = await api.create(projectId, {
        projectId,
        goal,
        constraints,
        criteria,
        checkpoint: checkpointFor(projectId, criteria, references),
        createKey: opaqueKey('workstream'),
      });
      setCreateOpen(false);
      await load();
      setSelectedId(row.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Workstream creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const revise = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!api || !projectId || !selected || busy) return;
    const data = new FormData(event.currentTarget);
    const goal = String(data.get('goal') ?? '').trim();
    const constraints = String(data.get('constraints') ?? '').trim();
    const criteria = String(data.get('criteria') ?? '').trim();
    if (!goal || !constraints || !criteria) { setError('Goal, constraints, and criteria are all required.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.revise(projectId, selected.workstream.id, {
        expectedRevision: selected.workstream.revision,
        goal,
        constraints,
        criteria,
      });
      setEditOpen(false);
      await load();
    } catch (reviseError) {
      setError(reviseError instanceof Error ? reviseError.message : 'Workstream changes could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const run = () => {
    if (!api || !projectId || !parentSessionId || !selected || !targetProfileId || busy) return;
    const wall = Math.trunc(maxWallTimeSeconds);
    const tokens = Math.trunc(maxTokens);
    if (!Number.isFinite(wall) || wall < 30 || wall > 3_600 || !Number.isFinite(tokens) || tokens < 1 || tokens > 2_000_000) {
      setError('Run limits must be 30–3600 seconds and 1–2,000,000 tokens.');
      return;
    }
    const queuedJob = selected.jobs.find((job) => job.id === selected.workstream.lastJobId);
    const commandKey = queuedJob?.state === 'queued'
      ? queuedJob.commandKey
      : commandKeys[selected.workstream.id] ?? opaqueKey('run');
    setCommandKeys((current) => ({ ...current, [selected.workstream.id]: commandKey }));
    void mutate(() => api.runNext(projectId, selected.workstream.id, {
      expectedRevision: selected.workstream.revision,
      commandKey,
      targetProfileId,
      parentSessionId,
      policy: { maxTurns: 1, maxWallTimeSeconds: wall, maxTokens: tokens, queueDeadlineAt: null },
      references: selected.workstream.checkpoint.references,
    }));
  };

  if (gateway.mode !== 'live' || !api) {
    return <section className="workstreams-panel" data-testid="workstreams-panel" aria-label="Workstreams">
      <p className="workstreams-empty" role="status">Workstreams are available only in an authenticated live Rhythm workspace.</p>
    </section>;
  }
  if (!projectId || !parentSessionId) {
    return <section className="workstreams-panel" data-testid="workstreams-panel" aria-label="Workstreams">
      <p className="workstreams-empty" role="status">Select a root session in a project to create or run a workstream.</p>
    </section>;
  }

  const currentJob = selected?.jobs.find((job) => job.id === selected.workstream.lastJobId) ?? null;
  const retryingQueuedIntent = Boolean(
    currentJob?.state === 'queued' &&
    (selected?.workstream.state === 'queued' || selected?.workstream.state === 'blocked'),
  );
  const canRun = Boolean(selected && (selected.workstream.state === 'ready' || retryingQueuedIntent) && selected.readiness.available && !selected.budget.holdReason && targetProfileId);
  const usageUnknown = currentJob?.result && recordText(currentJob.result, 'usageStatus') === 'unknown' && !currentJob.usage;
  const estimatedTokens = numberAt(currentJob?.estimate ?? null, 'authorizedTokens');
  const actualTokens = numberAt(currentJob?.usage ?? null, 'totalTokens');
  const overshoot = actualTokens !== null && estimatedTokens !== null && actualTokens > estimatedTokens;
  const unresolvedCriterionIds = selected?.workstream.checkpoint.criteria
    .filter((criterion) => criterion.status === 'pending' || criterion.status === 'blocked')
    .map((criterion) => criterion.id) ?? [];
  const acknowledgement = currentJob?.estimate?.estimateAcknowledgement;
  const acknowledgedEstimate = acknowledgement && typeof acknowledgement === 'object' && !Array.isArray(acknowledgement)
    ? acknowledgement as Record<string, unknown>
    : null;
  const waivableJobId = currentJob?.state === 'succeeded' &&
    recordText(currentJob.application, 'status') === 'quarantined' &&
    selected?.workstream.state !== 'paused' && selected?.workstream.state !== 'cancelled'
    ? currentJob.id
    : null;

  return <section className="workstreams-panel" data-testid="workstreams-panel" aria-label="Workstreams">
    <header className="workstreams-header">
      <div><p>Read-only coordinator</p><h3>Workstreams</h3></div>
      <div className="workstreams-header-actions">
        <button className="secondary-button compact" type="button" onClick={() => void load()} disabled={loading || busy} data-testid="workstreams-refresh">{loading ? 'Refreshing…' : 'Refresh'}</button>
        <button className="primary-button compact" type="button" onClick={() => { setCreateOpen((open) => !open); setEditOpen(false); }} disabled={busy} data-testid="workstreams-create">New</button>
      </div>
    </header>
    <p className="workstreams-safety-note">Every Run next creates one fresh, read-only worker. It never continues itself or applies output as completion.</p>
    {error && <p className="workstreams-error" role="alert">{error}</p>}

    {createOpen && <form className="workstreams-form" onSubmit={(event) => void create(event)} data-testid="workstreams-create-form">
      <label>Goal<textarea name="goal" rows={2} required data-autofocus placeholder="The exact outcome to inspect" /></label>
      <label>Constraints<textarea name="constraints" rows={2} required placeholder="Boundaries the read-only worker must preserve" /></label>
      <label>Criteria<textarea name="criteria" rows={2} required placeholder="One criterion per line" /></label>
      <label>Evidence selector <small>Optional; one <code>memory:&lt;record-id&gt;@sha256:&lt;hash&gt;</code> per line. The server resolves authority; source content is never entered here.</small><textarea name="references" rows={2} placeholder="memory:record-id@sha256:content-hash" /></label>
      <footer><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create workstream'}</button></footer>
    </form>}

    <div className="workstreams-layout">
      <div className="workstreams-list" role="listbox" aria-label="Workstreams" aria-busy={loading}>
        {!loading && !views.length && <p className="workstreams-empty" role="status">No workstreams in this project yet.</p>}
        {views.map((item) => <button key={item.workstream.id} className={`workstreams-list-row${item.workstream.id === selectedId ? ' selected' : ''}`} type="button" role="option" aria-selected={item.workstream.id === selectedId} onClick={() => { setSelectedId(item.workstream.id); setEditOpen(false); }}>
          <strong>{item.workstream.goal}</strong><small>{stateLabel(item.workstream.state)}{item.workstream.stateReason ? ` · ${stateLabel(item.workstream.stateReason)}` : ''}</small>
        </button>)}
      </div>
      <div className="workstreams-detail">
        {!selected ? <p className="workstreams-empty" role="status">Create or select a workstream.</p> : <>
          <header className="workstreams-detail-header">
            <div><span className={`workstreams-state state-${selected.workstream.state}`}>{stateLabel(selected.workstream.state)}</span><h4>{selected.workstream.goal}</h4></div>
            <button className="text-button" type="button" onClick={() => { setEditOpen((open) => !open); setCreateOpen(false); }} disabled={busy} data-testid="workstreams-edit">Edit</button>
          </header>
          {selected.workstream.stateReason && <p className="workstreams-reason" data-testid="workstreams-state-reason">{stateLabel(selected.workstream.stateReason)}</p>}
          <dl className="workstreams-facts">
            <div><dt>Next action</dt><dd>{selected.workstream.checkpoint.nextAction.kind}</dd></div>
            <div><dt>Revision</dt><dd>{selected.workstream.revision}</dd></div>
            <div><dt>Last progress</dt><dd>{compactTime(currentJob?.lastProgressAt ?? null)}</dd></div>
            <div><dt>Executor</dt><dd>{selected.readiness.available ? 'available' : stateLabel(selected.readiness.reason ?? 'unavailable')}</dd></div>
            <div><dt>Authorization</dt><dd>{selected.budget.authorizedTokens === null ? 'not established' : `${selected.budget.committedTokens.toLocaleString()} committed / ${selected.budget.authorizedTokens.toLocaleString()} tokens`}</dd></div>
            <div><dt>Remaining</dt><dd>{selected.budget.remainingTokens === null ? 'unavailable' : `${selected.budget.remainingTokens.toLocaleString()} tokens`}{selected.budget.holdReason ? ` · held: ${stateLabel(selected.budget.holdReason)}` : ''}</dd></div>
          </dl>
          <p className="workstreams-copy"><strong>Constraints:</strong> {selected.workstream.constraints}</p>
          <p className="workstreams-copy"><strong>Criteria:</strong> {selected.workstream.criteria}</p>

          {editOpen && <form className="workstreams-form" onSubmit={(event) => void revise(event)} data-testid="workstreams-edit-form">
            <label>Goal<textarea name="goal" rows={2} required defaultValue={selected.workstream.goal} /></label>
            <label>Constraints<textarea name="constraints" rows={2} required defaultValue={selected.workstream.constraints} /></label>
            <label>Criteria<textarea name="criteria" rows={2} required defaultValue={selected.workstream.criteria} /></label>
            <p className="workstreams-safety-note">Existing reference and evidence metadata stays unchanged by this edit.</p>
            <footer><button className="secondary-button" type="button" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save controls'}</button></footer>
          </form>}

          <fieldset className="workstreams-run-controls" disabled={busy || !canRun}>
            <legend>Explicit Run next</legend>
            <label>Worker profile<select value={targetProfileId} onChange={(event) => setTargetProfileId(event.target.value)}>{eligibleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
            <label>Wall time (seconds)<input type="number" min="30" max="3600" value={maxWallTimeSeconds} onChange={(event) => setMaxWallTimeSeconds(Number(event.target.value))} /></label>
            <label>Token authorization<input type="number" min="1" max="2000000" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label>
            <button className="primary-button" type="button" onClick={run} data-testid="workstreams-run-next">{retryingQueuedIntent ? 'Try queued worker' : 'Run next'}</button>
          </fieldset>
          {!selected.readiness.available && <p className="workstreams-safety-note">Run next is unavailable: {stateLabel(selected.readiness.reason ?? 'executor unavailable')}.</p>}
          {selected.budget.holdReason && <p className="workstreams-safety-note">A new worker is blocked by the durable authorization ledger. Resume cannot clear this hold.</p>}

          <div className="workstreams-actions">
            {selected.workstream.state !== 'paused' && selected.workstream.state !== 'cancelled' && <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.pause(projectId, selected.workstream.id, selected.workstream.revision))} data-testid="workstreams-pause">Pause</button>}
            {selected.workstream.state === 'paused' && <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.resume(projectId, selected.workstream.id, selected.workstream.revision))} data-testid="workstreams-resume">Resume</button>}
            {currentJob && ACTIVE_JOB_STATES.has(currentJob.state) && <button className="danger-button" type="button" disabled={busy} onClick={() => void mutate(() => api.cancel(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id }))} data-testid="workstreams-cancel">Cancel worker</button>}
          </div>

          <section className="workstreams-workers" aria-label="Workers">
            <h5>Workers</h5>
            {!selected.jobs.length && <p className="workstreams-empty">No worker has been admitted.</p>}
            {selected.jobs.map((job) => {
              const total = numberAt(job.usage, 'totalTokens');
              const authorized = numberAt(job.usage, 'authorizedTokens') ?? numberAt(job.estimate, 'authorizedTokens');
              return <article key={job.id} className="workstreams-worker">
                <header><strong>{stateLabel(job.state)}</strong><code>{job.id}</code></header>
                <dl><div><dt>Profile</dt><dd>{job.targetProfileId ?? 'unavailable'}</dd></div><div><dt>Requested model</dt><dd>{job.requestedProviderId && job.requestedModelId ? `${job.requestedProviderId}/${job.requestedModelId}` : 'not recorded'}</dd></div><div><dt>Served model</dt><dd>{recordText(job.result, 'servedProviderId') && recordText(job.result, 'servedModelId') ? `${recordText(job.result, 'servedProviderId')}/${recordText(job.result, 'servedModelId')}` : 'not terminal'}</dd></div><div><dt>Progress</dt><dd>{compactTime(job.lastProgressAt)}</dd></div><div><dt>Usage</dt><dd>{total === null ? 'unknown' : `${total.toLocaleString()} tokens`}{authorized !== null ? ` / ${authorized.toLocaleString()} authorized` : ''}</dd></div><div><dt>Application</dt><dd>{recordText(job.application, 'status') ?? 'pending'}</dd></div></dl>
                {total !== null && authorized !== null && total > authorized && <p className="workstreams-overshoot" role="status">Usage exceeded the declared authorization by {(total - authorized).toLocaleString()} tokens.</p>}
                {job.stateReason && <p className="workstreams-reason">{stateLabel(job.stateReason)}</p>}
              </article>;
            })}
          </section>

          {currentJob && <section className="workstreams-evidence" aria-label="Evidence and result receipt">
            <h5>Evidence and result receipt</h5>
            <p>Result status: {recordText(currentJob.result, 'status') ?? 'not terminal'}. Application: {recordText(currentJob.application, 'reason') ?? 'not recorded'}.</p>
            <ul>{selected.workstream.checkpoint.criteria.map((criterion) => <li key={criterion.id}>{criterion.id}: {criterion.status}{criterion.receiptId ? <code> · {criterion.receiptId}</code> : ''}</li>)}</ul>
            {selected.workstream.checkpoint.references.length === 0 && <p className="workstreams-safety-note">No qualified evidence reference is bound to this workstream.</p>}
            {selected.workstream.checkpoint.references.map((reference) => {
              const evidence = evidenceByKey[`${selected.workstream.id}:${reference.sourceId}`];
              return <div key={reference.sourceId} className="workstreams-evidence-source">
                <p><strong>Selector:</strong> <code>{reference.sourceId}</code> · expected <code>{reference.expectedVersion}</code></p>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void inspectEvidence(selected.workstream.id, reference.sourceId)}>Inspect authoritative evidence</button>
                {evidence && <p className={evidence.eligible ? 'workstreams-safety-note' : 'workstreams-overshoot'}>{evidence.eligible ? 'Qualified preexisting evidence' : `Evidence unavailable: ${stateLabel(evidence.reason ?? 'unavailable')}`}{evidence.canonicalId ? ` · ${evidence.canonicalId}` : ''}{evidence.observedVersion ? ` · ${evidence.observedVersion}` : ''}</p>}
                {evidence?.eligible && waivableJobId && unresolvedCriterionIds.length > 0 && <button className="primary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.verifyCriteria(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: waivableJobId, sourceId: reference.sourceId, criterionIds: unresolvedCriterionIds }))}>Verify all unresolved criteria</button>}
              </div>;
            })}
            {waivableJobId && unresolvedCriterionIds.length > 0 && <div className="workstreams-ack"><p>A waiver resolves every remaining criterion in one reviewed receipt; it cannot be applied one line at a time.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.waiveCriteria(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: waivableJobId, criterionIds: unresolvedCriterionIds }))}>Waive all unresolved criteria</button></div>}
            {usageUnknown && <div className="workstreams-ack"><p>Actual usage is unavailable. Recording the declared estimate charge never raises the authorization cap.</p><p>Proposed charge: {estimatedTokens === null ? 'unavailable' : `${estimatedTokens.toLocaleString()} tokens`} · basis: declared worker authorization · uncertainty: actual usage unavailable.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.acknowledgeUsage(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id, accept: true }))}>Record estimate charge</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.acknowledgeUsage(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id, accept: false }))}>Keep usage hold</button></div>}
            {acknowledgedEstimate && <p className="workstreams-safety-note">Recorded estimate charge: {numberAt(acknowledgedEstimate, 'chargedEstimateTokens')?.toLocaleString() ?? 'unavailable'} tokens · remaining authorization: {numberAt(acknowledgedEstimate, 'remainingAuthorizedTokens')?.toLocaleString() ?? 'unavailable'} · {recordText(acknowledgedEstimate, 'basis') ?? 'basis unavailable'} · {recordText(acknowledgedEstimate, 'uncertainty') ?? 'uncertainty unavailable'}.</p>}
            {selected.workstream.state === 'unknown' && <div className="workstreams-ack"><p>This worker is held as unknown. Check only the server's exact engine binding; no retry will be sent unless a later explicit Run next is admitted.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => api.reconcileUnknown(projectId, selected.workstream.id, { expectedRevision: selected.workstream.revision, jobId: currentJob.id }))}>Check authoritative worker status</button></div>}
          </section>}
        </>}
      </div>
    </div>
  </section>;
}
