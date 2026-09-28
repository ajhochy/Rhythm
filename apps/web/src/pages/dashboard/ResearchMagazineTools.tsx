import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { navigate } from '../../components/Shell';
import { Timestamp } from '../../components/Timestamp';
import { seedComposer } from '../../composerSeed';
import { LiveArtifactsGatewayError, type LiveArtifactDetail, type LiveArtifactsGateway } from '../../gateway/live-artifacts';
import type { ResearchGateway } from '../../gateway/research';
import { ANCHOR, MAX_COMMENTS, magazineLink, magazineState, versionDiff, type MagazineState } from '../../research/magazineArtifact';
import { researchExportName, saveTextFile } from '../../saveTextFile';

type Selection = { quote: string; anchor: string | null; sourceUrl: string | null };

function selectionParams(params: unknown): Selection | null {
  const value = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : null;
  if (!value || Object.keys(value).some((key) => !['quote', 'anchor', 'sourceUrl'].includes(key))) return null;
  const quote = typeof value.quote === 'string' ? value.quote.trim().slice(0, 1000) : '';
  const anchor = value.anchor ?? null;
  const sourceUrl = value.sourceUrl ?? null;
  if (!quote || (anchor !== null && (typeof anchor !== 'string' || !ANCHOR.test(anchor)))) return null;
  if (sourceUrl !== null && (typeof sourceUrl !== 'string' || !isHttpUrl(sourceUrl))) return null;
  return { quote, anchor: anchor as string | null, sourceUrl: sourceUrl as string | null };
}

function isHttpUrl(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && value.length <= 4096; }
  catch { return false; }
}

export function magazinePrompt(artifactId: string, { quote, anchor, sourceUrl }: Selection): string {
  return `${[
    quote.split('\n').map((line) => `> ${line}`).join('\n'),
    sourceUrl ? `Source: ${sourceUrl}` : '',
    `Magazine section: [${anchor ? `#${anchor}` : 'magazine'}](${magazineLink(artifactId, anchor)})`,
  ].filter(Boolean).join('\n\n')}\n\n`;
}

/**
 * Research-magazine extensions for one artifact tab: the frame methods behind "Ask about this",
 * "Comment", source links and section focus, plus the version/comment/export toolbar. Magazine
 * state is held here (not in tab.detail) so saving a comment never re-runs the frame bridge.
 */
export function useResearchMagazine({ detail, liveArtifacts, research, focusAnchor }: {
  detail: LiveArtifactDetail | null;
  liveArtifacts: LiveArtifactsGateway;
  research: ResearchGateway | undefined;
  focusAnchor: string | null;
}) {
  const [state, setState] = useState<MagazineState | null>(() => magazineState(detail?.state));
  const stateRef = useRef(state);
  const revisionRef = useRef(detail?.currentStateRevision ?? 0);
  const focusRef = useRef(focusAnchor);
  focusRef.current = focusAnchor;
  const [viewing, setViewing] = useState<{ version: number; html: string } | null>(null);
  const [commenting, setCommenting] = useState<Selection | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const next = magazineState(detail?.state);
    stateRef.current = next; setState(next); revisionRef.current = detail?.currentStateRevision ?? 0;
  }, [detail]);

  const saveState = async (change: (current: MagazineState) => MagazineState) => {
    if (!detail || !stateRef.current) return;
    for (let attempt = 0; ; attempt++) {
      const next = change(stateRef.current);
      try {
        const updated = await liveArtifacts.updateState(detail.id, revisionRef.current, next);
        revisionRef.current = updated.currentStateRevision; stateRef.current = next; setState(next);
        return;
      } catch (err) {
        if (attempt > 0 || !(err instanceof LiveArtifactsGatewayError) || err.status !== 409) throw err;
        const fresh = await liveArtifacts.get(detail.id);
        stateRef.current = magazineState(fresh.state) ?? stateRef.current; revisionRef.current = fresh.currentStateRevision;
      }
    }
  };

  const ask = async (selection: Selection) => {
    const current = stateRef.current;
    if (!detail || !current || !research) throw new Error('research_unavailable');
    let sessionId = current.discussionSessionId;
    if (!sessionId) {
      sessionId = (await research.startDiscussion(current.projectId, current.runId, [])).sessionId;
      const discussionSessionId = sessionId;
      await saveState((latest) => ({ ...latest, discussionSessionId })).catch(() => undefined);
    }
    seedComposer(sessionId, magazinePrompt(detail.id, selection));
    navigate(`/agents?sessionId=${encodeURIComponent(sessionId)}`);
    return { sessionId };
  };

  /** Frame method dispatch; undefined = not a research method (the host reports unsupported). */
  const handle = (method: string, params: unknown): Promise<unknown> | undefined => {
    if (!stateRef.current || !method.startsWith('research.')) return undefined;
    if (method === 'research.focus') {
      const anchor = focusRef.current; focusRef.current = null;
      return Promise.resolve({ anchor });
    }
    if (method === 'research.openSource') {
      const url = params && typeof params === 'object' ? (params as { url?: unknown }).url : null;
      if (typeof url !== 'string' || !isHttpUrl(url)) return Promise.reject(new Error('invalid_request'));
      const open = window.rhythmShell?.openExternal;
      if (open) return open(url).then(() => ({ opened: true }));
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve({ opened: true });
    }
    const selection = selectionParams(params);
    if (!selection) return Promise.reject(new Error('invalid_request'));
    if (method === 'research.ask') return ask(selection);
    if (method === 'research.comment') { setCommenting(selection); return Promise.resolve({ opened: true }); }
    return undefined;
  };

  const exportAs = async (format: 'html' | 'markdown') => {
    if (!state || !research) return;
    setError('');
    try {
      const runId = viewing ? state.versions.find((entry) => entry.version === viewing.version)?.runId ?? state.runId : state.runId;
      const text = await research.exportRun(state.projectId, runId, format);
      await saveTextFile(researchExportName(detail?.title.replace(/ — research magazine$/, '') ?? 'research', runId, format), text, format === 'html' ? 'text/html' : 'text/markdown');
    } catch { setError('Export failed. Try again.'); }
  };

  const view = async (version: number) => {
    setError('');
    const entry = state?.versions.find((candidate) => candidate.version === version);
    if (!state || !entry || !research || version === state.versions.at(-1)?.version) { setViewing(null); return; }
    try { setViewing({ version, html: await research.magazine(state.projectId, entry.runId) }); }
    catch { setError('That version could not be loaded.'); }
  };

  const saveComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('comment') ?? '').trim().slice(0, 1000);
    const selection = commenting;
    if (!text || !selection) return;
    setError('');
    try {
      await saveState((current) => ({
        ...current,
        comments: [...current.comments, {
          id: crypto.randomUUID(), version: current.versions.at(-1)?.version ?? 1,
          anchor: selection.anchor, quote: selection.quote, text, createdAt: new Date().toISOString(),
        }].slice(-MAX_COMMENTS),
      }));
      setCommenting(null); setShowComments(true);
    } catch { setError('The comment could not be saved. Try again.'); }
  };

  if (!state) return { handle, toolbar: null as ReactNode, versionFrame: null as ReactNode, viewingOld: false };
  const latest = state.versions.at(-1);
  const shown = viewing ? state.versions.find((entry) => entry.version === viewing.version) : latest;
  const previous = shown ? state.versions[state.versions.indexOf(shown) - 1] : undefined;
  const diff = shown ? versionDiff(previous, shown) : { added: [], removed: [] };
  const toolbar = <div className="research-magazine-tools" data-testid="research-magazine-tools">
    <label>Version <select value={viewing?.version ?? latest?.version ?? ''} onChange={(event) => void view(Number(event.target.value))} data-testid="research-magazine-versions">
      {[...state.versions].reverse().map((entry) => <option key={entry.version} value={entry.version}>v{entry.version}{entry.version === latest?.version ? ' (current)' : ''} · run {entry.runId.slice(0, 8)}</option>)}
    </select></label>
    {shown && <span className="research-magazine-meta" data-testid="research-magazine-diff"><Timestamp value={shown.createdAt} />{previous ? ` · ${diff.added.length || diff.removed.length ? `${diff.added.length ? `Added: ${diff.added.join(', ')}` : ''}${diff.added.length && diff.removed.length ? ' · ' : ''}${diff.removed.length ? `Removed: ${diff.removed.join(', ')}` : ''}` : 'Same sections as the previous version'}` : ' · First version'}</span>}
    <button type="button" className="secondary-button" onClick={() => void exportAs('html')} data-testid="research-magazine-export-html">Export HTML</button>
    <button type="button" className="secondary-button" onClick={() => void exportAs('markdown')} data-testid="research-magazine-export-markdown">Export Markdown</button>
    <button type="button" className="secondary-button" aria-expanded={showComments} onClick={() => setShowComments((open) => !open)} data-testid="research-magazine-comments-toggle">Comments ({state.comments.length})</button>
    {error && <p role="alert">{error}</p>}
    {showComments && <ul className="research-magazine-comments" data-testid="research-magazine-comments">
      {state.comments.length === 0 ? <li>No comments yet. Select text in the magazine and choose Comment; comments on the current version guide the next run.</li>
        : state.comments.map((comment) => <li key={comment.id}><strong>v{comment.version}{comment.anchor ? ` · #${comment.anchor}` : ''}</strong>{comment.quote && <blockquote>{comment.quote}</blockquote>}<p>{comment.text}</p></li>)}
    </ul>}
    <FocusDialog open={Boolean(commenting)} onClose={() => setCommenting(null)} title="Comment on this section" description="Comments on the current version are passed to the next run's plan as reader guidance." testId="research-magazine-comment-dialog">
      <form className="form-grid" onSubmit={(event) => void saveComment(event)}>
        {commenting && <blockquote className="span-2">{commenting.quote}</blockquote>}
        <label className="field span-2">Comment<textarea name="comment" required maxLength={1000} rows={4} data-autofocus /></label>
        <footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setCommenting(null)}>Cancel</button><button className="primary-button" type="submit" data-testid="research-magazine-comment-save">Save comment</button></footer>
      </form>
    </FocusDialog>
  </div>;
  // Older versions are read-only: their own magazine CSP (script-src 'none') stays in place, and
  // sandbox="" grants nothing, not even scripts.
  const versionFrame = viewing ? <iframe data-testid="research-magazine-version-frame" title={`${detail?.title ?? 'Magazine'} v${viewing.version}`} sandbox="" referrerPolicy="no-referrer" srcDoc={viewing.html} /> : null;
  return { handle, toolbar, versionFrame, viewingOld: Boolean(viewing) };
}
