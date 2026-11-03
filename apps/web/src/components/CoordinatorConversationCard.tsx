import './CoordinatorConversationCard.css';
import { useState } from 'react';
import type { CoordinatorGoalRun } from '../gateway/coordinator-conversations';
import type { CoordinatorConversationViewState } from './use-coordinator-conversation';

type Props = {
  state: CoordinatorConversationViewState;
  onRefresh: () => void;
  onRetry: () => void;
  onReviewConflict: () => void;
  onBeginNewMessageAfterReview: () => void;
  onReturnToNormal: () => void;
  /** Open the run's own session (to watch it or answer what it is waiting on). */
  onOpenRun: (childSessionId: string) => void;
  /** Stop a running run and every specialist it delegated to. */
  onCancelRun: (goalId: string) => Promise<boolean>;
};

const RUN_STATUS_LABEL: Record<CoordinatorGoalRun['status'], string> = {
  running: 'Running',
  needs_you: 'Needs you',
  finished: 'Finished',
  failed: 'Failed',
  cancelled: 'Stopped',
  unknown: 'Status unknown',
};

function runLine(run: CoordinatorGoalRun): string {
  return [
    run.branch ?? 'branch pending',
    run.usage.totalTokens.toLocaleString() + ' tokens',
    ...(run.reported ? ['reported in chat'] : []),
  ].join(' · ');
}

function phaseLabel(state: CoordinatorConversationViewState): string | undefined {
  if (state.phase === 'opening') return 'Opening coordination…';
  if (state.phase === 'refreshing') return 'Refreshing coordination…';
  if (state.phase === 'sending') return 'Sending coordinator message…';
  return state.notice?.message;
}

/** Details → Runs: the coding runs this Rhythm Coordinator chat started. */
export function CoordinatorConversationCard({
  state,
  onRefresh,
  onRetry,
  onReviewConflict,
  onBeginNewMessageAfterReview,
  onReturnToNormal,
  onOpenRun,
  onCancelRun,
}: Props) {
  const [stopping, setStopping] = useState<string>();
  const [confirmStop, setConfirmStop] = useState<string>();
  if (!state.enabled) return null;
  const busy = state.phase === 'opening' || state.phase === 'refreshing' || state.phase === 'sending';
  const announcement = phaseLabel(state);
  const runs = state.runs ?? [];
  const started = new Set(runs.map((run) => run.goalId));
  const waiting = (state.conversation?.goals ?? []).filter((goal) => goal.state === 'captured' && !started.has(goal.id));
  const rejected = state.phase === 'review' && state.pendingProvenance === 'rejected';
  const canStartNewMessage = Boolean(
    state.pendingCommand && rejected && state.conversation &&
    state.reviewedConflictRevision === state.conversation.controlRevision,
  );

  return (
    <section className="coordinator-conversation-card" aria-labelledby="coordinator-runs-title" data-testid="coordinator-conversation-card">
      <header>
        <h2 id="coordinator-runs-title">Coding runs</h2>
        <button className="secondary-button compact" type="button" disabled={busy} onClick={rejected ? onReviewConflict : onRefresh} data-testid={rejected ? 'coordinator-review-conflict' : 'coordinator-refresh'}>
          {rejected ? 'Refresh and review' : 'Refresh'}
        </button>
      </header>
      {announcement ? <p className="coordinator-conversation-notice" role="status" aria-live="polite" aria-atomic="true">{announcement}</p> : null}
      {state.pendingCommand && state.pendingProvenance !== 'rejected' && !busy ? (
        <button className="link-button" type="button" onClick={onRetry} data-testid="coordinator-retry">Retry same message</button>
      ) : null}
      {canStartNewMessage ? (
        <button className="link-button" type="button" onClick={onBeginNewMessageAfterReview} data-testid="coordinator-new-message">Write a new message</button>
      ) : null}
      {runs.length ? (
        <ul className="coordinator-goal-list" aria-label="Coding runs" data-testid="coordinator-runs">
          {[...runs].reverse().map((run) => {
            const active = run.status === 'running' || run.status === 'needs_you';
            return (
              <li key={run.goalId} className="coordinator-goal" data-status={run.status}>
                <button className="coordinator-run-open" type="button" disabled={!run.childSessionId}
                  onClick={() => run.childSessionId && onOpenRun(run.childSessionId)}
                  aria-label={`Open run: ${run.objective}`} data-testid="coordinator-run-open">
                  <strong className={`coordinator-run-status is-${run.status}`}>
                    {run.status === 'needs_you' ? 'Needs you — open to answer' : RUN_STATUS_LABEL[run.status]}
                  </strong>
                  <p>{run.objective}</p>
                  <small>{runLine(run)}</small>
                </button>
                {active && confirmStop !== run.goalId ? (
                  <button className="link-button" type="button" disabled={stopping === run.goalId}
                    onClick={() => setConfirmStop(run.goalId)} data-testid="coordinator-run-stop">
                    {stopping === run.goalId ? 'Stopping…' : 'Stop'}
                  </button>
                ) : null}
                {active && confirmStop === run.goalId ? (
                  <span className="coordinator-run-confirm">
                    <small>Stop this run? Commits already on its branch are kept.</small>
                    <button className="link-button" type="button" data-testid="coordinator-run-stop-confirm" onClick={() => {
                      setConfirmStop(undefined);
                      setStopping(run.goalId);
                      void onCancelRun(run.goalId).finally(() => setStopping(undefined));
                    }}>Yes, stop</button>
                    <button className="link-button" type="button" onClick={() => setConfirmStop(undefined)}>Keep running</button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="coordinator-conversation-empty">No coding runs yet. Give Rhythm a coding goal in the chat, naming the repo by its full path.</p>
      )}
      {waiting.length ? (
        <>
          <h3 className="coordinator-subhead">Waiting to start</h3>
          <ul className="coordinator-goal-list" aria-label="Goals waiting to start">
            {waiting.map((goal) => <li key={goal.id} className="coordinator-goal"><p>{goal.objective}</p></li>)}
          </ul>
        </>
      ) : null}
      <button className="link-button" type="button" onClick={onReturnToNormal} data-testid="coordinator-return-normal">
        Return to normal chat
      </button>
    </section>
  );
}
