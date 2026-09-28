import { LiveArtifactsGatewayError, type LiveArtifactsGateway } from '../gateway/live-artifacts';
import type { ResearchGateway, ResearchGuidance, ResearchProject, ResearchProjectRun } from '../gateway/research';

// A research project's magazine is ONE production live artifact (a living document): each run
// that reaches a synthesis becomes a new bundle revision + a version entry in the artifact state,
// and reader comments live beside those versions. The renderer publishes it because it holds the
// production bearer; the local API only records the link (+ the Gallery entry).

export interface MagazineVersion { version: number; runId: string; createdAt: string; headings: string[] }
export interface MagazineComment { id: string; version: number; anchor: string | null; quote: string; text: string; createdAt: string }
export interface MagazineState {
  kind: 'research-magazine';
  projectId: string;
  runId: string;
  discussionSessionId?: string;
  versions: MagazineVersion[];
  comments: MagazineComment[];
}

export const MAX_VERSIONS = 50;
export const MAX_COMMENTS = 100;
export const ANCHOR = /^[A-Za-z0-9_-]{1,120}$/;
export const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function magazineState(state: unknown): MagazineState | null {
  const value = state && typeof state === 'object' ? state as Partial<MagazineState> : null;
  if (value?.kind !== 'research-magazine' || typeof value.projectId !== 'string' || typeof value.runId !== 'string') return null;
  return { ...value, versions: Array.isArray(value.versions) ? value.versions : [], comments: Array.isArray(value.comments) ? value.comments : [] } as MagazineState;
}

export function magazineLink(artifactId: string, anchor?: string | null): string {
  return `#/dashboard?artifactId=${artifactId}${anchor && ANCHOR.test(anchor) ? `&anchor=${anchor}` : ''}`;
}

/** Section headings, for the cheap version diff (added/removed sections). */
export function magazineHeadings(html: string): string[] {
  return [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
    .filter(Boolean).slice(0, 60);
}

export function versionDiff(previous: MagazineVersion | undefined, current: MagazineVersion): { added: string[]; removed: string[] } {
  if (!previous) return { added: [], removed: [] };
  return { added: current.headings.filter((h) => !previous.headings.includes(h)), removed: previous.headings.filter((h) => !current.headings.includes(h)) };
}

/** Comments on the newest version: the reader's feedback on the report the next run replaces. */
export function guidanceFrom(state: MagazineState | null): ResearchGuidance[] {
  const latest = state?.versions.at(-1)?.version;
  if (!state || latest === undefined) return [];
  return state.comments.filter((comment) => comment.version === latest).slice(-20)
    .map(({ anchor, quote, text }) => ({ anchor, quote: quote.slice(0, 1000), text: text.slice(0, 1000) }));
}

// Runs inside the sandboxed artifact frame (allow-scripts only, opaque origin). Its only reach is
// window.rhythm.request -> the host's closed method set; it never fetches, navigates or reads the host.
export const MAGAZINE_SCRIPT = `(function(){
  var rhythm = window.rhythm; if (!rhythm || typeof rhythm.request !== 'function') return;
  var ask = function(method, params){ try { rhythm.request(method, params).catch(function(){}); } catch (_) {} };
  var headings = function(){ return Array.prototype.slice.call(document.querySelectorAll('article h1[id],article h2[id],article h3[id]')); };
  var anchorFor = function(node){ var found = null; headings().forEach(function(h){ if (h === node || (h.compareDocumentPosition(node) & 4)) found = h.id; }); return found; };
  var sourceFor = function(node){ var el = node && node.nodeType === 1 ? node : node && node.parentElement; var link = el && el.closest && (el.closest('a[href^="http"]') || (el.closest('li') && el.closest('li').querySelector('a[href^="http"]'))); return link ? link.href : null; };
  var bar = document.createElement('div'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Selection actions'); bar.hidden = true;
  bar.style.cssText = 'position:absolute;z-index:10;display:flex;gap:4px;padding:4px;background:#18211d;border-radius:8px;box-shadow:0 4px 14px #0004;font:13px system-ui,sans-serif';
  var button = function(label, method){ var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'border:0;border-radius:6px;padding:4px 8px;background:#fffdf7;color:#18211d;cursor:pointer';
    b.addEventListener('mousedown', function(e){ e.preventDefault(); });
    b.addEventListener('click', function(){ var sel = getSelection(); var quote = String(sel || '').trim().slice(0, 1000); if (!quote) return; var node = sel.anchorNode; bar.hidden = true;
      ask(method, { quote: quote, anchor: anchorFor(node && node.nodeType === 1 ? node : node && node.parentElement), sourceUrl: sourceFor(node) }); });
    bar.appendChild(b); };
  button('Ask about this', 'research.ask'); button('Comment', 'research.comment');
  document.body.appendChild(bar);
  var place = function(){ var sel = getSelection(); var text = String(sel || '').trim(); if (!text || !sel.rangeCount) { bar.hidden = true; return; }
    var rect = sel.getRangeAt(0).getBoundingClientRect(); bar.hidden = false; bar.style.top = (scrollY + rect.top - bar.offsetHeight - 8) + 'px'; bar.style.left = Math.max(8, scrollX + rect.left) + 'px'; };
  document.addEventListener('mouseup', function(){ setTimeout(place, 0); }); document.addEventListener('keyup', place);
  Array.prototype.forEach.call(document.querySelectorAll('details li'), function(li){ var link = li.querySelector('a[href^="http"]'); if (!link) return;
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Ask'; b.setAttribute('aria-label', 'Ask about ' + link.href); b.style.cssText = 'margin-left:.5rem;font:12px system-ui,sans-serif';
    b.addEventListener('click', function(){ ask('research.ask', { quote: link.href, anchor: null, sourceUrl: link.href }); }); li.appendChild(b); });
  document.addEventListener('click', function(e){ var link = e.target && e.target.closest && e.target.closest('a[href^="http"]'); if (!link) return; e.preventDefault(); ask('research.openSource', { url: link.href }); }, true);
  rhythm.request('research.focus', {}).then(function(r){ var el = r && r.anchor && document.getElementById(r.anchor); if (el) el.scrollIntoView(); }).catch(function(){});
})();`;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The magazine ships its own `script-src 'none'` CSP; the artifact render supplies the policy instead. */
export function magazineBundle(html: string) {
  return { html: html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, ''), css: '', js: MAGAZINE_SCRIPT };
}

/**
 * Publish (or update in place) the project's magazine for `run`. Idempotent: the same run with the
 * same bytes is a no-op; the same run with changed bytes is a new bundle revision but no new
 * version; a new run is a new version. Returns the artifact id.
 */
export async function publishMagazine(research: ResearchGateway, liveArtifacts: LiveArtifactsGateway, project: ResearchProject, run: ResearchProjectRun): Promise<string> {
  const html = await research.magazine(project.id, run.id);
  const bundle = magazineBundle(html);
  const bundleHash = await sha256Hex(JSON.stringify(bundle));
  const title = `${project.name} — research magazine`;
  const version = (versions: MagazineVersion[]): MagazineVersion => ({ version: (versions.at(-1)?.version ?? 0) + 1, runId: run.id, createdAt: new Date().toISOString(), headings: magazineHeadings(html) });
  let existing = null;
  if (project.magazineArtifactId) {
    try { existing = await liveArtifacts.get(project.magazineArtifactId); }
    catch (error) { if (!(error instanceof LiveArtifactsGatewayError) || ![404, 410].includes(error.status)) throw error; }
  }
  if (existing && !existing.deletedAt) {
    const state = magazineState(existing.state) ?? { kind: 'research-magazine' as const, projectId: project.id, runId: run.id, versions: [], comments: [] };
    const known = state.versions.some((entry) => entry.runId === run.id);
    if (existing.currentBundleHash !== bundleHash) await liveArtifacts.updateBundle(existing.id, existing.currentBundleRevision, bundle);
    if (!known || state.runId !== run.id) {
      const versions = known ? state.versions : [...state.versions, version(state.versions)].slice(-MAX_VERSIONS);
      await liveArtifacts.updateState(existing.id, existing.currentStateRevision, { ...state, runId: run.id, versions });
    }
    if (existing.title !== title) await liveArtifacts.patch(existing.id, { title });
    return existing.id;
  }
  const workspace = await liveArtifacts.currentWorkspace();
  const state: MagazineState = { kind: 'research-magazine', projectId: project.id, runId: run.id, versions: [version([])], comments: [] };
  const created = await liveArtifacts.create({ type: 'html', title, workspaceId: workspace.id, visibility: 'private', bundle, state });
  await research.setMagazineArtifact(project.id, created.id);
  return created.id;
}
