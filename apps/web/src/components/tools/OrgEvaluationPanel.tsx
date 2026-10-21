import { useEffect, useState } from 'react';
import { useGateway } from '../../gateway/context';
import type { EvaluationDetail, EvaluationJob, EvaluationSettings } from '../../gateway/org-proposals';

const number = (value: number) => value.toLocaleString();

export function OrgEvaluationPanel() {
  const gateway = useGateway().domains.orgProposals!;
  const [settings, setSettings] = useState<EvaluationSettings | null>(null);
  const [draft, setDraft] = useState<EvaluationSettings | null>(null);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextSettings, nextJobs] = await Promise.all([gateway.getEvaluationSettings(), gateway.listEvaluations()]);
      setSettings(nextSettings);
      setDraft(nextSettings);
      setJobs(nextJobs.jobs);
      if (selectedId) setDetail(await gateway.getEvaluation(selectedId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evaluation activity could not be loaded');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function select(id: string) {
    setSelectedId(id);
    setDetail(null);
    setError(null);
    try { setDetail(await gateway.getEvaluation(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Evaluation detail could not be loaded'); }
  }

  async function save() {
    if (!draft || !Number.isSafeInteger(draft.tokenLimit) || draft.tokenLimit <= 0 || ![2, 3].includes(draft.candidateCount)) {
      setSaveError('Enter a positive whole-run token limit and choose two or three candidates.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await gateway.updateEvaluationSettings(draft);
      setSettings(saved);
      setDraft(saved);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Evaluation settings could not be saved');
    } finally { setSaving(false); }
  }

  const final = detail?.candidates.find(candidate => candidate.id === detail.job.finalCandidateId);
  const original = detail?.candidates.find(candidate => candidate.role === 'original');
  const composition = detail?.candidates.find(candidate => candidate.role === 'composition');
  const parts = composition?.compositionParts ?? final?.compositionParts ?? [];
  const validation = detail?.results.filter(result => result.phase === 'validation') ?? [];
  const probes = detail?.results.filter(result => result.phase === 'probe') ?? [];
  const cycleSummary = (job: EvaluationJob) => {
    const children = jobs.filter(child => child.budgetRootId === job.id);
    const passed = children.filter(child => child.status === 'qualified').length;
    const inconclusive = children.filter(child => child.status === 'inconclusive').length;
    const failed = children.filter(child => child.status === 'failed').length;
    return `${children.length} tested · ${passed} passed · ${inconclusive} inconclusive${failed ? ` · ${failed} failed` : ''}`;
  };
  const statusLabel = (job: EvaluationJob) => job.budgetRootId === null && job.status === 'qualified' ? 'completed' : job.status;
  return <div className="org-evaluation-panel">
    <section aria-label="Evaluation settings" className="tool-notice">
      <h3>Evaluation settings</h3>
      {draft ? <>
        <label>Whole-run token limit<input type="number" min="1" step="1" value={draft.tokenLimit} onChange={event => setDraft({ ...draft, tokenLimit: Number(event.target.value) })} /></label>
        <label>Candidates per review<select value={draft.candidateCount} onChange={event => setDraft({ ...draft, candidateCount: Number(event.target.value) as 2 | 3 })}><option value="2">2</option><option value="3">3</option></select></label>
        <button type="button" className="secondary-button compact" disabled={saving || settings?.tokenLimit === draft.tokenLimit && settings?.candidateCount === draft.candidateCount} onClick={() => void save()}>Save evaluation settings</button>
      </> : <p>{loading ? 'Loading evaluation settings…' : 'Settings unavailable.'}</p>}
      {saveError && <p role="alert">{saveError}</p>}
      <p>This cap covers candidate generation, probes, composition, judges, retries, and final validation. Only a qualified final version reaches human review.</p>
    </section>
    <section aria-label="Evaluation activity" className="tool-notice">
      <h3>Evaluation activity</h3>
      <button type="button" className="secondary-button compact" onClick={() => void refresh()}>Refresh evaluations</button>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Loading evaluations…</p> : jobs.length === 0 ? <p>No evaluations yet</p> : <div className="org-evaluation-activity">
        <ul>{jobs.map(job => <li key={job.id}><button type="button" data-testid={`evaluation-${job.id}`} onClick={() => void select(job.id)} aria-current={selectedId === job.id ? 'true' : undefined}>{job.targetRef} · {statusLabel(job)}{job.budgetRootId === null ? ` · ${cycleSummary(job)}` : ''} · {number(job.maxTokens)} {job.budgetRootId === null ? 'whole-run' : 'shared cycle'} token cap</button></li>)}</ul>
        {selectedId && !detail && !error && <p>Loading evaluation detail…</p>}
        {detail && <article data-testid={`evaluation-${detail.job.id}-details`}>
          <h4>{detail.job.targetRef} · {statusLabel(detail.job)}</h4>
          {detail.job.budgetRootId === null && <p>{cycleSummary(detail.job)}</p>}
          {detail.job.failureReason && <p role="status">{detail.job.failureReason}</p>}
          {detail.budget.hasUnknownUsage && <p role="status">Token usage is unknown; this evaluation is inconclusive.</p>}
          <dl>
            <div><dt>Original</dt><dd>{original?.configHash ?? detail.job.originalHash}</dd></div>
            <div><dt>Final version</dt><dd>{final?.configHash ?? 'No qualified final version'}</dd></div>
            <div><dt>Token use</dt><dd>{number(detail.budget.settledTokens)} used · {number(detail.budget.outstandingTokens)} reserved · {number(detail.budget.maxTokens)} cap</dd></div>
            <div><dt>Final validation reserve</dt><dd>{number(detail.budget.validationReserveTokens)}</dd></div>
            <div><dt>Available</dt><dd>{number(detail.budget.totalAvailableTokens)}</dd></div>
          </dl>
          <h5>Candidates and composition</h5>
          <ul>{detail.candidates.map(candidate => {
            const runs = probes.filter(result => result.candidateId === candidate.id);
            return <li key={candidate.id}>{candidate.role === 'variant' ? `Candidate ${candidate.ordinal}` : candidate.role} · {runs.length ? `${runs.filter(result => result.status === 'pass').length}/${runs.length} probes passed` : 'No probe result'}{runs.length > 0 && <> · scores {runs.map(result => result.score === null ? 'unknown' : result.score).join(', ')}</>}<details><summary>Configuration version</summary><code>{candidate.configHash}</code></details></li>;
          })}</ul>
          {parts.length > 0 && <section aria-label="Composition decisions"><h6>What the final version kept</h6><ul>{parts.map((part, index) => <li key={`${part.sourceCandidateId}-${part.changePath}-${index}`}><strong>{part.retained ? 'Kept' : 'Rejected'} {part.changePath}</strong> from {detail.candidates.find(candidate => candidate.id === part.sourceCandidateId)?.role === 'variant' ? `candidate ${detail.candidates.find(candidate => candidate.id === part.sourceCandidateId)?.ordinal}` : 'an earlier candidate'}: {part.reason}. Evidence: {part.evidenceResultIds.map(id => { const result = detail.results.find(item => item.id === id); return result ? `${result.taskKey} ${result.status}${result.score === null ? '' : ` (score ${result.score})`}` : 'missing result'; }).join('; ')}</li>)}</ul></section>}
          <h5>Final validation</h5>
          {validation.length === 0 ? <p>Independent validation has no result yet.</p> : <ul>{validation.map(result => <li key={result.id}><strong>{result.candidateId === original?.id ? 'Original' : result.candidateId === final?.id ? 'Final' : result.candidateId}</strong> · {result.status} · {result.taskKey} · score {result.score ?? 'unknown'} · {result.tokenUsage ? number(result.tokenUsage.totalTokens) + ' tokens' : 'usage unknown'}<pre>{result.receiptJson}</pre>{result.failureReason && <p>{result.failureReason}</p>}</li>)}</ul>}
          <h5>Master diff</h5>
          {final ? <details><summary>Exact tested change payload</summary><pre>{final.changeJson}</pre></details> : <p>Diff unavailable until a final candidate is composed.</p>}
          <h5>Evidence</h5>
          <p>Execution receipts above contain the observed task results and tool effects. Approval, when available, remains in the proposal queue.</p>
        </article>}
      </div>}
    </section>
  </div>;
}
