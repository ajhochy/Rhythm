import type { ColonyThread } from './model';

export function ColonyInspector({ thread }: { thread: ColonyThread | null }) {
  if (!thread) return <aside className="colony-inspector" aria-label="Task inspector"><p className="colony-muted">Select a task in the list or scene to inspect it.</p></aside>;
  const known = thread.activity !== 'unknown' && thread.running !== null && thread.stale !== true;
  return <aside className="colony-inspector" aria-label={`Inspect ${thread.title || 'task'}`}>
    <p className="eyebrow">{thread.parentId ? 'Worker task' : 'Task'}</p>
    <dl>
      <div><dt>Harness</dt><dd>{thread.harnessName || thread.harness || 'Unknown harness'}</dd></div>
      <div><dt>Activity</dt><dd>{known ? thread.hasError ? 'Blocked' : thread.running ? 'Working' : thread.prState === 'MERGED' ? 'Shipped' : thread.unread ? 'Waiting on you' : 'Quiet' : 'Activity unknown'}</dd></div>
      <div><dt>Folder</dt><dd>{thread.checkout?.missing || !thread.cwd ? 'Folder missing' : thread.cwd}</dd></div>
      <div><dt>Branch</dt><dd>{thread.gitBranch || 'No branch recorded'}</dd></div>
      {thread.parentId && <div><dt>Parent</dt><dd>{thread.parentId}</dd></div>}
    </dl>
  </aside>;
}
