import type { ColonyThread } from './model';
import { ColonyTaskMenu } from './menus';

type Action = 'open' | 'showParent' | 'reveal' | 'copyPath' | 'archive' | 'restore' | 'viewed';

export function ColonyInspector({ thread, onAction }: { thread: ColonyThread | null; onAction(kind: Action): void }) {
  if (!thread) return <aside className="colony-inspector" aria-label="Task inspector"><p className="colony-muted">Select a task in the list or scene to inspect it.</p></aside>;
  const known = thread.activity !== 'unknown' && thread.running !== null && thread.stale !== true;
  const destination = thread.harness === 'rhythm' ? 'Rhythm' : thread.harness === 'codex' ? 'Codex' : null;
  const unavailable = thread.navigationReason || `${thread.harnessName || thread.harness || 'This harness'} exact opening is not qualified.`;
  return <aside className="colony-inspector" aria-label={`Inspect ${thread.title || 'task'}`}>
    <p className="eyebrow">{thread.parentId ? 'Worker task' : 'Task'}</p>
    <div className="colony-inspector-actions">
      <button type="button" className="primary-button" disabled={!destination} aria-label={destination ? `Open in ${destination}` : 'Open unavailable'} onClick={() => onAction('open')}>{destination ? `Open in ${destination}` : 'Open unavailable'}</button>
      {thread.parentId && <button type="button" className="secondary-button" onClick={() => onAction('showParent')}>Show parent task</button>}
      <button type="button" className="secondary-button" disabled={thread.archived === true} onClick={() => onAction('archive')}>Archive from Colony</button>
      <button type="button" className="secondary-button" disabled={thread.archived !== true} onClick={() => onAction('restore')}>Restore to Colony</button>
      <ColonyTaskMenu thread={thread} onAction={onAction} />
    </div>
    {!destination && <p className="colony-action-reason">{unavailable}</p>}
    <dl>
      <div><dt>Harness</dt><dd>{thread.harnessName || thread.harness || 'Unknown harness'}</dd></div>
      <div><dt>Activity</dt><dd>{known ? thread.hasError ? 'Blocked' : thread.running ? 'Working' : thread.prState === 'MERGED' ? 'Shipped' : thread.unread ? 'Waiting on you' : 'Quiet' : 'Activity unknown'}</dd></div>
      <div><dt>Folder</dt><dd>{thread.checkout?.missing || !thread.cwd ? 'Folder missing' : thread.cwd}</dd></div>
      <div><dt>Branch</dt><dd>{thread.gitBranch || 'No branch recorded'}</dd></div>
      {thread.parentId && <div><dt>Parent</dt><dd>{thread.parentId}</dd></div>}
    </dl>
  </aside>;
}
