import './CoordinatorConversationCard.css';
import { useState } from 'react';
import type {
  CoordinatorAvailability,
  CoordinatorPlanAdmission,
  CoordinatorReceiptContextItem,
  CoordinatorTaskContextItem,
} from '../gateway/coordinator-conversations';
import type { CoordinatorConversationViewState, CoordinatorPlanConsent } from './use-coordinator-conversation';

type Props = {
  state: CoordinatorConversationViewState;
  onRefresh: () => void;
  onRetry: () => void;
  onRetryPlan?: () => void;
  onPreparePlan?: (goalId: string, consent: CoordinatorPlanConsent) => void;
  onContinuePlan?: (goalId: string, authorizationId: string) => void;
  onReviewConflict: () => void;
  onBeginNewMessageAfterReview: () => void;
  onReturnToNormal: () => void;
  onInspectWorkstream: (workstreamId: string) => void;
};

function taskLabel(item: CoordinatorTaskContextItem): string {
  return item.title + (item.status === 'waiting_for_reply' ? ' · waiting for reply' : '');
}

function availabilityLabel(source: string, availability: CoordinatorAvailability): string {
  if (availability.state === 'available') return source + ': available';
  if (availability.state === 'not_configured') return source + ': not configured';
  return source + ': unavailable';
}

function dedupedHolds(receipts: CoordinatorReceiptContextItem[]): string[] {
  const seen = new Set<string>();
  return receipts.flatMap((receipt) => {
    if (seen.has(receipt.id)) return [];
    seen.add(receipt.id);
    if (receipt.actualUsage?.state === 'unknown') return ['Unknown usage — hold needs review'];
    if (receipt.actualUsage?.state === 'overshoot') return ['Usage overshoot — hold needs review'];
    return [];
  });
}

function contextLines(state: CoordinatorConversationViewState): string[] {
  const context = state.context;
  if (!context) return [];
  const lines: string[] = [
    availabilityLabel('Tasks', context.availability.tasks),
    availabilityLabel('Schedules', context.availability.schedules),
    availabilityLabel('Workstreams', context.availability.workstreams),
    availabilityLabel('Receipts', context.availability.receipts),
    availabilityLabel('Dayflow activity', context.availability.manualActivity),
  ];
  if (context.todayTasks.length) {
    lines.push('Today (' + context.today + '): ' + context.todayTasks.map(taskLabel).join(' · '));
  } else if (context.availability.tasks.state === 'available') {
    lines.push('Today (' + context.today + '): no reported tasks');
  }
  if (context.waitingForReply.length) {
    lines.push('Waiting for reply: ' + context.waitingForReply.map(taskLabel).join(' · '));
  }
  if (context.scheduledPriorities.length) {
    lines.push('Scheduled priorities: ' + context.scheduledPriorities.map((schedule) => schedule.name + (schedule.enabled ? '' : ' · paused')).join(' · '));
  }
  if (context.verifiedYesterday.length) {
    lines.push('Verified yesterday (' + context.yesterday + '): ' + context.verifiedYesterday.length + ' verified receipt' + (context.verifiedYesterday.length === 1 ? '' : 's'));
  } else if (context.availability.receipts.state === 'available') {
    lines.push('Yesterday (' + context.yesterday + '): no verified completion reported');
  }
  if (context.doneWithUnknownCompletionDate.length) {
    lines.push('Completion date unknown: ' + context.doneWithUnknownCompletionDate.map(taskLabel).join(' · '));
  }
  if (context.activeWorkstreams.length) {
    lines.push('Rhythm work: ' + context.activeWorkstreams.length + ' active workstream' + (context.activeWorkstreams.length === 1 ? '' : 's'));
  } else if (context.availability.workstreams.state === 'available') {
    lines.push('Rhythm work: no active workstreams reported');
  }
  if (context.executionSucceededGoalUnverified.length) {
    lines.push('Execution succeeded — verification pending for ' + context.executionSucceededGoalUnverified.length + ' workstream' + (context.executionSucceededGoalUnverified.length === 1 ? '' : 's'));
  }
  if (context.staleExecutions.length) {
    lines.push('Earlier execution needs review for ' + context.staleExecutions.length + ' workstream' + (context.staleExecutions.length === 1 ? '' : 's'));
  }
  return lines;
}

function phaseLabel(state: CoordinatorConversationViewState): string | undefined {
  if (state.phase === 'opening') return 'Opening coordination…';
  if (state.phase === 'refreshing') return 'Refreshing coordination…';
  if (state.phase === 'sending') {
    return state.pendingPlan
      ? 'Submitting managed planning request…'
      : 'Sending coordinator message…';
  }
  return state.notice?.message;
}

function managedWorkBudgetLine(budget: Record<string, unknown>): string {
  const actual = typeof budget.actualTokens === 'number' && Number.isFinite(budget.actualTokens) ? budget.actualTokens : undefined;
  const authorized = typeof budget.authorizedTokens === 'number' && Number.isFinite(budget.authorizedTokens) ? budget.authorizedTokens : undefined;
  if (actual !== undefined && authorized !== undefined) return `Budget: ${actual.toLocaleString()} actual of ${authorized.toLocaleString()} authorized tokens.`;
  if (actual !== undefined) return `Budget: ${actual.toLocaleString()} actual tokens reported by the server.`;
  return budget.holdReason === null ? 'Budget: server reports no current hold.' : 'Budget status reported by the server.';
}

function managedJobLine(jobs: unknown[]): string {
  const states = jobs.flatMap((job) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) return [];
    const state = (job as Record<string, unknown>).state;
    return typeof state === 'string' && ['queued', 'claimed', 'running', 'unknown', 'succeeded', 'failed', 'cancelled'].includes(state) ? [state] : [];
  });
  if (!states.length) return jobs.length ? `${jobs.length} server job${jobs.length === 1 ? '' : 's'} reported.` : 'No server job is reported yet.';
  return `Server job status: ${states.join(', ')}.`;
}

export function CoordinatorConversationCard({
  state,
  onRefresh,
  onRetry,
  onRetryPlan,
  onPreparePlan,
  onContinuePlan,
  onReviewConflict,
  onBeginNewMessageAfterReview,
  onReturnToNormal,
  onInspectWorkstream,
}: Props) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [planningGoalId, setPlanningGoalId] = useState<string>();
  const [totalTokenAuthorization, setTotalTokenAuthorization] = useState('20000');
  const [maxTurns, setMaxTurns] = useState('1');
  const [maxWallTimeSeconds, setMaxWallTimeSeconds] = useState('90');
  const [expiresInSeconds, setExpiresInSeconds] = useState('900');
  const [acknowledgesSoftBudget, setAcknowledgesSoftBudget] = useState(false);
  const [planningPurpose, setPlanningPurpose] = useState<CoordinatorPlanAdmission['purpose']>('decompose');
  const [acknowledgesScopedWorkspaceExecution, setAcknowledgesScopedWorkspaceExecution] = useState(false);
  if (!state.enabled) return null;
  const lines = contextLines(state);
  const holds = state.context ? dedupedHolds([...state.context.usageHolds, ...state.context.receipts]) : [];
  const busy = state.phase === 'opening' || state.phase === 'refreshing' || state.phase === 'sending';
  const announcement = phaseLabel(state);
  const canStartNewMessage = Boolean(
    state.pendingCommand &&
    state.pendingProvenance === 'rejected' &&
    state.phase === 'review' &&
    state.conversation &&
    state.reviewedConflictRevision === state.conversation.controlRevision,
  );
  const activePlanGoal = state.conversation?.goals.find((goal) => goal.id === planningGoalId);
  const submitPlan = () => {
    if (!activePlanGoal || !onPreparePlan) return;
    onPreparePlan(activePlanGoal.id, {
      totalTokenAuthorization: Number(totalTokenAuthorization),
      maxTurns: Number(maxTurns) as CoordinatorPlanAdmission['maxTurns'],
      maxWallTimeSeconds: Number(maxWallTimeSeconds),
      expiresInSeconds: Number(expiresInSeconds),
      acknowledgesSoftTotalTokenAuthorization: acknowledgesSoftBudget as true,
      purpose: planningPurpose,
      ...(planningPurpose === 'execute' && acknowledgesScopedWorkspaceExecution
        ? { acknowledgesScopedWorkspaceExecution: true as const }
        : {}),
    });
  };

  return (
    <section className="coordinator-conversation-card" aria-labelledby="coordinator-conversation-title" data-testid="coordinator-conversation-card">
      <header>
        <div>
          <p className="coordinator-conversation-eyebrow">Rhythm</p>
          <h2 id="coordinator-conversation-title">Coordination</h2>
        </div>
        <span className={"coordinator-conversation-phase " + (busy ? 'is-busy' : '')}>{busy ? 'Syncing' : 'Status'}</span>
      </header>
      {announcement ? <p className="coordinator-conversation-notice" role="status" aria-live="polite" aria-atomic="true">{announcement}</p> : null}
      {state.conversation?.goals.length ? (
        <div className="coordinator-goal-list" aria-label="Captured goals">
          {state.conversation.goals.map((goal) => (
            <article key={goal.id} className="coordinator-goal">
              <p>{goal.objective}</p>
              <small>{goal.state === 'captured'
                ? 'Captured — not dispatched'
                : goal.state === 'linked'
                  ? 'Linked workstream'
                  : 'Blocked'}</small>
              {goal.linkedWorkstreamId ? (
                <button className="link-button" type="button" onClick={() => onInspectWorkstream(goal.linkedWorkstreamId!)}>
                  Inspect linked workstream
                </button>
              ) : null}
              {onPreparePlan && (state.conversation?.schemaVersion === 3 || state.conversation?.schemaVersion === 4) && state.conversation.primaryOwnerRoot === true && !goal.linkedWorkstreamId ? (
                <button className="link-button" type="button" disabled={busy || Boolean(state.pendingPlan)} onClick={() => setPlanningGoalId((current) => current === goal.id ? undefined : goal.id)}>
                  {planningGoalId === goal.id ? 'Hide managed planning consent' : 'Plan this goal'}
                </button>
              ) : null}
              {onContinuePlan && (state.conversation?.schemaVersion === 3 || state.conversation?.schemaVersion === 4) && state.conversation.primaryOwnerRoot === true ? state.conversation?.continuations?.filter((continuation) =>
                continuation.goalId === goal.id && continuation.status === 'consumed' && continuation.consumedTurns < continuation.maxTurns,
              ).map((continuation) => (
                <button key={continuation.authorizationId} className="link-button" type="button" disabled={busy || Boolean(state.pendingPlan)} onClick={() => onContinuePlan(goal.id, continuation.authorizationId)}>
                  Continue managed work
                </button>
              )) : null}
            </article>
          ))}
        </div>
      ) : state.phase === 'ready' ? <p className="coordinator-conversation-empty">Add a goal in this same composer when you are ready.</p> : null}
      {activePlanGoal ? (
        <form className="coordinator-plan-consent" onSubmit={(event) => { event.preventDefault(); submitPlan(); }}>
          <h3>Managed work consent</h3>
          <p>Authorize one finite server-managed turn for “{activePlanGoal.objective}”. This is a soft total-token authorization across input, output, reasoning, cache, and any reconciled overrun — not a completion promise.</p>
          <div className="coordinator-plan-grid">
            <label>Managed-work purpose<select aria-label="Managed-work purpose" value={planningPurpose} onChange={(event) => setPlanningPurpose(event.target.value as CoordinatorPlanAdmission['purpose'])}>
              <option value="decompose">Decompose this goal</option>
              <option value="continue">Continue managed work</option>
              <option value="execute">Execute in the scoped workspace</option>
            </select></label>
            <label>Total token authorization<input min="1" max="2000000" inputMode="numeric" type="number" value={totalTokenAuthorization} onChange={(event) => setTotalTokenAuthorization(event.target.value)} /></label>
            <label>Maximum outer turns<input min="1" max="8" type="number" value={maxTurns} onChange={(event) => setMaxTurns(event.target.value)} /></label>
            <label>Worker wall time (seconds)<input min="30" max="300" type="number" value={maxWallTimeSeconds} onChange={(event) => setMaxWallTimeSeconds(event.target.value)} /></label>
            <label>Consent expiry (seconds)<input min="30" max="3600" type="number" value={expiresInSeconds} onChange={(event) => setExpiresInSeconds(event.target.value)} /></label>
          </div>
          <label className="coordinator-plan-ack"><input checked={acknowledgesSoftBudget} type="checkbox" onChange={(event) => setAcknowledgesSoftBudget(event.target.checked)} /> I understand this is an explicit, finite soft total-token authorization and does not verify the goal.</label>
          {planningPurpose === 'execute' ? <label className="coordinator-plan-ack"><input checked={acknowledgesScopedWorkspaceExecution} type="checkbox" onChange={(event) => setAcknowledgesScopedWorkspaceExecution(event.target.checked)} /> I explicitly authorize this one server-derived scoped-workspace execution. This does not create a recurring grant.</label> : null}
          <div className="coordinator-conversation-actions">
            <button className="secondary-button" disabled={busy || !acknowledgesSoftBudget || planningPurpose === 'execute' && !acknowledgesScopedWorkspaceExecution} type="submit" data-testid="coordinator-prepare-plan">Start managed work</button>
            <button className="secondary-button" type="button" onClick={() => setPlanningGoalId(undefined)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {state.plannedWorkstream ? (
        <section className="coordinator-managed-status" aria-label="Latest managed-work status">
          <strong>Latest managed-work response</strong>
          <p>{state.plannedWorkstream.workstream.state} · {state.plannedWorkstream.readiness.available ? 'server reports ready' : 'server reports a readiness hold'}</p>
          <small>{managedJobLine(state.plannedWorkstream.jobs)} {managedWorkBudgetLine(state.plannedWorkstream.budget)} Execution status is not criterion verification.</small>
        </section>
      ) : null}
      {holds.length ? <ul className="coordinator-holds" aria-label="Coordination holds">{holds.map((line, index) => <li key={line + index}>{line}</li>)}</ul> : null}
      {lines.length ? (
        <details className="coordinator-context" open={detailsExpanded} onToggle={(event) => setDetailsExpanded(event.currentTarget.open)}>
          <summary>Yesterday, today, and Rhythm work</summary>
          <ul>{lines.map((line, index) => <li key={line + index}>{line}</li>)}</ul>
        </details>
      ) : null}
      <div className="coordinator-conversation-actions">
        {state.phase !== 'review' || state.pendingProvenance !== 'rejected' ? (
          <button className="secondary-button" type="button" disabled={busy} onClick={onRefresh} data-testid="coordinator-refresh">
            Refresh
          </button>
        ) : null}
        {state.pendingCommand && state.pendingProvenance !== 'rejected' && !busy ? (
          <button className="secondary-button" type="button" onClick={onRetry} data-testid="coordinator-retry">
            Retry same message
          </button>
        ) : null}
        {state.pendingPlan && state.notice?.retryable && !busy && onRetryPlan ? (
          <button className="secondary-button" type="button" onClick={onRetryPlan} data-testid="coordinator-retry-plan">
            Retry same managed request
          </button>
        ) : null}
        {state.phase === 'review' && state.pendingCommand && state.pendingProvenance === 'rejected' ? (
          <button className="secondary-button" type="button" onClick={onReviewConflict} data-testid="coordinator-review-conflict">
            Refresh and review
          </button>
        ) : null}
        {canStartNewMessage ? (
          <button className="secondary-button" type="button" onClick={onBeginNewMessageAfterReview} data-testid="coordinator-new-message">
            Write a new message
          </button>
        ) : null}
        <button className="secondary-button" type="button" onClick={onReturnToNormal} data-testid="coordinator-return-normal">
          Return to normal chat
        </button>
      </div>
    </section>
  );
}
