import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { useGateway } from '../../gateway/context';
import { useAuthUser } from '../../gateway/auth';
import { LiveArtifactsGatewayError, type LiveArtifact, type LiveArtifactDetail, type LiveArtifactsGateway, type LiveArtifactVisibility, type PcoServicesReadRequest } from '../../gateway/live-artifacts';
import type { MessageThreadParticipant } from '../../gateway/messages';
import type { UserPreferencesGateway } from '../../gateway/user-preferences';
import { DashboardPage } from '.';
import './liveArtifacts.css';

type TabStatus = 'loading' | 'ready' | 'unavailable' | 'deleted' | 'conflict' | 'error';

interface ArtifactTab {
  id: string;
  title: string;
  status: TabStatus;
  detail: LiveArtifactDetail | null;
  html: string | null;
  frameUrl: string | null;
  errorMessage: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Injected into every artifact document's srcDoc (appended after the artifact's own markup — HTML
// parsers accept a trailing <script> even without an explicit <body>). This is the ONLY primitive
// the sandboxed document is given: postMessage to the parent and back. There is no generic
// fetch/XHR/URL surface here — mirrors the closed bridge contract at
// apps/electron/src/artifact-policy.mjs:1-7 (ARTIFACT_METHODS), scoped here to the one operation the
// web host actually implements (pco.services.read — post-m1-p8-c4g).
//
// A `srcdoc` iframe (even sandboxed, even without allow-same-origin) INHERITS its parent's CSP —
// index.html's `script-src 'self'` would otherwise silently block this exact inline script. Its
// SHA-256 is allowlisted there instead of adding 'unsafe-inline'. If this string ever changes,
// regenerate the hash: node -e "console.log('sha256-'+require('crypto').createHash('sha256').update(<the text between <script> and <\/script>>,'utf8').digest('base64'))"
const ARTIFACT_BRIDGE_SCRIPT = `<script>(function(){
  var pending = {}; var n = 0;
  var tokenBytes = new Uint32Array(4); crypto.getRandomValues(tokenBytes);
  var documentToken = Array.from(tokenBytes, function(value) { return value.toString(16).padStart(8, '0'); }).join('');
  var documentChannel = new MessageChannel();
  documentChannel.port1.onmessage = function(event) {
    var data = event.data;
    if (!data || data.__rhythmBridgeResponse !== true || data.documentToken !== documentToken || !pending[data.id]) return;
    var entry = pending[data.id]; delete pending[data.id];
    if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.result);
  };
  documentChannel.port1.start();
  window.parent.postMessage({ __rhythmBridgeDocument: true, documentToken: documentToken }, '*', [documentChannel.port2]);
  window.rhythm = { request: function(method, params) {
    return new Promise(function(resolve, reject) {
      var id = 'r' + (++n) + '-' + Date.now();
      pending[id] = { resolve: resolve, reject: reject };
      documentChannel.port1.postMessage({ __rhythmBridge: true, documentToken: documentToken, id: id, method: method, params: params });
    });
  } };
})();<\/script>`;

// Exact request-union validation (post-m1-p8-c4g) — matches the server's own contract at
// apps/api_server/src/controllers/live_artifact_capabilities_controller.ts:26-45. Checked here too
// (not just server-side) so a malformed request never even reaches the network — the criterion
// requires the rejection to produce zero API mutations.
function isValidPcoRequest(params: unknown): params is PcoServicesReadRequest {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const keys = Object.keys(params as Record<string, unknown>).sort();
  const op = (params as { operation?: unknown }).operation;
  if (op === 'list_service_types') return keys.length === 1 && keys[0] === 'operation';
  if (op === 'list_plans') {
    const { serviceTypeId, filter } = params as { serviceTypeId?: unknown; filter?: unknown };
    return keys.length === 3 && typeof serviceTypeId === 'string' && (filter === 'future' || filter === 'past');
  }
  if (op === 'list_plan_items') {
    const { serviceTypeId, planId } = params as { serviceTypeId?: unknown; planId?: unknown };
    return keys.length === 3 && typeof serviceTypeId === 'string' && typeof planId === 'string';
  }
  return false;
}

function nativeArtifactFrameUrl(id: string): string | null {
  return window.location.protocol === 'rhythm:' ? `rhythm-artifact://app/${encodeURIComponent(id)}` : null;
}

function injectBrowserArtifactBridge(document: string): string {
  const firstScript = document.search(/<script\b/i);
  if (firstScript >= 0) return `${document.slice(0, firstScript)}${ARTIFACT_BRIDGE_SCRIPT}${document.slice(firstScript)}`;
  const headEnd = document.search(/<\/head\s*>/i);
  if (headEnd >= 0) return `${document.slice(0, headEnd)}${ARTIFACT_BRIDGE_SCRIPT}${document.slice(headEnd)}`;
  const doctypeEnd = document.match(/^<!doctype[^>]*>/i)?.[0].length ?? 0;
  return `${document.slice(0, doctypeEnd)}${ARTIFACT_BRIDGE_SCRIPT}${document.slice(doctypeEnd)}`;
}

function mapError(error: unknown): { status: TabStatus; message: string } {
  if (error instanceof LiveArtifactsGatewayError) {
    if (error.status === 404) return { status: 'unavailable', message: 'This live artifact is unavailable.' };
    if (error.status === 410 || error.code === 'artifact_deleted') return { status: 'deleted', message: 'This live artifact was deleted.' };
    if (error.status === 409 || error.code === 'CONFLICT') return { status: 'conflict', message: 'This live artifact has a conflict — reload to see the current revision.' };
    return { status: 'error', message: 'Could not load this live artifact. Try again.' };
  }
  return { status: 'error', message: 'Could not load this live artifact. Try again.' };
}

// Owner-only sharing controls (post-m1-p8-c2b). Visibility and collaborators are the same
// authorization surface the API already enforces (apps/api_server/src/controllers/live_artifacts_controller.ts) —
// this dialog only ever sends the exact {visibility} PATCH, {userId} POST, and DELETE the server
// already accepts; a non-owner never sees the "Sharing" trigger at all (checked by the caller).
function SharingDialog({
  open, onClose, artifactId, visibility, liveArtifacts, listWorkspaceUsers, onVisibilityChange,
}: {
  open: boolean;
  onClose(): void;
  artifactId: string;
  visibility: LiveArtifactVisibility;
  liveArtifacts: LiveArtifactsGateway;
  listWorkspaceUsers(): Promise<MessageThreadParticipant[]>;
  onVisibilityChange(next: LiveArtifactVisibility): void;
}) {
  const [directory, setDirectory] = useState<MessageThreadParticipant[]>([]);
  const [collaborators, setCollaborators] = useState<{ userId: number }[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    void liveArtifacts.collaborators(artifactId).then(setCollaborators).catch(() => setCollaborators([]));
    void listWorkspaceUsers().then(setDirectory).catch(() => setDirectory([]));
  }, [open, artifactId, liveArtifacts, listWorkspaceUsers]);

  const nameFor = (userId: number) => directory.find((user) => user.id === userId)?.name ?? `User ${userId}`;
  const matches = search.trim() ? directory.filter((user) => user.name.toLowerCase().includes(search.toLowerCase()) && !collaborators.some((c) => c.userId === user.id)) : [];

  async function addCollaborator(userId: number) {
    await liveArtifacts.addCollaborator(artifactId, userId);
    setCollaborators((current) => [...current, { userId }]);
    setSearch('');
  }

  async function removeCollaborator(userId: number) {
    await liveArtifacts.removeCollaborator(artifactId, userId);
    setCollaborators((current) => current.filter((c) => c.userId !== userId));
  }

  return (
    <FocusDialog open={open} onClose={onClose} title="Sharing" description="Choose who can open this live artifact." testId="live-artifact-sharing">
      <label>
        Visibility
        <select
          value={visibility}
          onChange={(event) => {
            const next = event.target.value as LiveArtifactVisibility;
            onVisibilityChange(next);
            void liveArtifacts.patch(artifactId, { visibility: next });
          }}
        >
          <option value="private">Private</option>
          <option value="shared">Shared</option>
          <option value="organization">Organization</option>
        </select>
      </label>
      <div className="artifact-picker-search">
        <input type="search" role="searchbox" aria-label="Search workspace users" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {matches.length > 0 && (
        <div role="listbox" aria-label="Workspace users" className="artifact-picker-list">
          {matches.map((user) => (
            <button key={user.id} type="button" role="option" aria-selected={false} className="artifact-picker-option" onClick={() => void addCollaborator(user.id)}>
              {user.name}
            </button>
          ))}
        </div>
      )}
      {collaborators.length > 0 && (
        <ul className="artifact-collaborator-list">
          {collaborators.map(({ userId }) => (
            <li key={userId}>
              {nameFor(userId)}
              <button type="button" className="secondary-button" aria-label={`Remove ${nameFor(userId)}`} onClick={() => void removeCollaborator(userId)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </FocusDialog>
  );
}

function LiveArtifactSurface({
  tab, onReload, isOwner, liveArtifacts, listWorkspaceUsers,
}: {
  tab: ArtifactTab;
  onReload(): void;
  isOwner: boolean;
  liveArtifacts: LiveArtifactsGateway;
  listWorkspaceUsers(): Promise<MessageThreadParticipant[]>;
}) {
  const [sharingOpen, setSharingOpen] = useState(false);
  const [visibility, setVisibility] = useState<LiveArtifactVisibility | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameGenerationRef = useRef(0);

  // Host side of the artifact bridge (post-m1-p8-c4g). Bound to exactly this tab's id and current
  // declaredCapabilities — a stale/removed tab's listener is torn down by the cleanup below, so a
  // response can never be delivered against a since-closed or switched artifact.
  useEffect(() => {
    const generation = ++frameGenerationRef.current;
    const detail = tab.detail;
    const sourceWindow = iframeRef.current?.contentWindow;
    let activePort: MessagePort | null = null;
    if (tab.status !== 'ready' || !detail || !sourceWindow) {
      return () => { if (frameGenerationRef.current === generation) frameGenerationRef.current += 1; };
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== sourceWindow) return;
      const document = event.data as { __rhythmBridgeDocument?: boolean; documentToken?: string } | null;
      const port = event.ports[0];
      if (!document || document.__rhythmBridgeDocument !== true || typeof document.documentToken !== 'string' || !/^[0-9a-f]{32}$/.test(document.documentToken) || !port) return;
      activePort?.close();
      activePort = port;
      port.onmessage = (portEvent: MessageEvent) => {
        const data = portEvent.data as { __rhythmBridge?: boolean; documentToken?: string; id?: string; method?: string; params?: unknown } | null;
        if (!data || data.__rhythmBridge !== true || data.documentToken !== document.documentToken || typeof data.id !== 'string') return;
        const respond = (payload: { result?: unknown; error?: string }) => {
          if (frameGenerationRef.current !== generation || iframeRef.current?.contentWindow !== sourceWindow || activePort !== port) return;
          port.postMessage({ __rhythmBridgeResponse: true, documentToken: document.documentToken, id: data.id, ...payload });
        };
        if (data.method !== 'pco.services.read') { respond({ error: 'unsupported_method' }); return; }
        if (!detail.declaredCapabilities.includes('pco.services.read')) { respond({ error: 'capability_not_declared' }); return; }
        if (!isValidPcoRequest(data.params)) { respond({ error: 'invalid_request' }); return; }
        liveArtifacts.pcoServicesRead(tab.id, data.params)
          .then((result) => respond({ result }))
          .catch((error) => respond({ error: error instanceof Error ? error.message : 'request_failed' }));
      };
      port.start();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      activePort?.close();
      activePort = null;
      if (frameGenerationRef.current === generation) frameGenerationRef.current += 1;
    };
  }, [tab.id, tab.status, tab.detail, liveArtifacts]);

  if (tab.status === 'loading') {
    return (
      <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
        <p role="status">Loading live artifact…</p>
      </section>
    );
  }
  if (tab.status !== 'ready' || !tab.detail) {
    return (
      <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
        <p role={tab.status === 'error' ? 'alert' : 'status'}>{tab.errorMessage}</p>
        <button type="button" className="secondary-button" onClick={onReload}>Reload</button>
      </section>
    );
  }
  const detail = tab.detail;
  const currentVisibility = visibility ?? detail.visibility;
  return (
    <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
      <header className="live-artifact-toolbar">
        <div>
          <h2>{detail.title}</h2>
          <p>
            Updated by {detail.updatedByDisplayName ?? 'Unknown'} · {formatDate(detail.updatedAt)} · bundle revision {detail.currentBundleRevision} · state revision {detail.currentStateRevision} · {currentVisibility}
          </p>
        </div>
        <div>
          {isOwner && <button type="button" className="secondary-button" onClick={() => setSharingOpen(true)}>Sharing</button>}
          <button type="button" className="secondary-button" onClick={onReload}>Reload</button>
        </div>
      </header>
      {/* sandbox="allow-scripts" (no allow-same-origin) keeps this an opaque, isolated origin: the
          artifact bundle is untrusted content and must never reach network, file, popup,
          navigation, or download primitives — apps/api_server/src/controllers/live_artifacts_controller.ts:64-69
          already denies connect-src/forms/frames/objects in the served document's own CSP. */}
      <iframe
        ref={iframeRef}
        data-testid="live-artifact-frame"
        title={detail.title}
        sandbox="allow-scripts"
        {...(tab.frameUrl ? { src: tab.frameUrl } : { srcDoc: injectBrowserArtifactBridge(tab.html ?? '') })}
      />
      {isOwner && (
        <SharingDialog
          open={sharingOpen}
          onClose={() => setSharingOpen(false)}
          artifactId={tab.id}
          visibility={currentVisibility}
          liveArtifacts={liveArtifacts}
          listWorkspaceUsers={listWorkspaceUsers}
          onVisibilityChange={setVisibility}
        />
      )}
    </section>
  );
}

function ArtifactPicker({ open, onClose, gateway, onSelect }: {
  open: boolean;
  onClose(): void;
  gateway: LiveArtifactsGateway;
  onSelect(id: string, title: string): void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [artifacts, setArtifacts] = useState<LiveArtifact[]>([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    setStatus('loading');
    try {
      const list = await gateway.list();
      setArtifacts(list);
      setStatus(list.length ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    if (open) { setSearch(''); void load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = artifacts.filter((artifact) => artifact.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <FocusDialog open={open} onClose={onClose} title="Add live artifact" description="Search and open an HTML live artifact." testId="live-artifact-picker">
      {status === 'loading' && <p role="status">Loading live artifacts…</p>}
      {status === 'error' && (
        <>
          <p role="alert">Could not load live artifacts.</p>
          <button type="button" className="secondary-button" onClick={() => void load()} data-testid="live-artifact-picker-retry">Retry</button>
        </>
      )}
      {status !== 'loading' && status !== 'error' && (
        <>
          <div className="artifact-picker-search">
            <input type="search" role="searchbox" aria-label="Search live artifacts" value={search} data-autofocus onChange={(event) => setSearch(event.target.value)} />
            {search && <button type="button" className="secondary-button" onClick={() => setSearch('')}>Clear search</button>}
          </div>
          {status === 'empty' && <p>No HTML live artifacts yet.</p>}
          {status === 'ready' && filtered.length === 0 && <p>No matching live artifacts.</p>}
          {status === 'ready' && filtered.length > 0 && (
            <div role="listbox" aria-label="Live artifacts" className="artifact-picker-list">
              {filtered.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="artifact-picker-option"
                  onClick={() => onSelect(artifact.id, artifact.title)}
                >
                  {artifact.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </FocusDialog>
  );
}

const MAX_IMPORT_BYTES = 900 * 1024;
// Always shown for any accepted preview rather than scanning the source for the exact tags that
// happen to trigger it — the sandboxed iframe (allow-scripts only, post-m1-p8-c4c/c4e) already
// blocks every one of these regardless of what a per-tag scan would find, so the honest, simplest
// warning is a blanket one instead of a content-scan that could miss an obfuscated equivalent.
const IMPORT_WARNING = 'Imported HTML runs in an isolated sandbox: external resources, network requests, frames, and media will not load.';

interface HtmlImportPreview { title: string; source: string }

async function readHtmlImportFile(file: File): Promise<{ preview: HtmlImportPreview } | { error: string }> {
  if (!/\.html?$/i.test(file.name)) return { error: 'File must use an html or htm extension.' };
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_IMPORT_BYTES) return { error: 'File exceeds the 900 KiB import limit.' };
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return { error: 'File is not valid UTF-8.' };
  }
  const titleMatch = source.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.html?$/i, '');
  return { preview: { title, source } };
}

// HTML import (post-m1-p8-c5a/c5b). Reference: apps/desktop_flutter/lib/features/live_artifacts —
// the desktop app's import dialog is the same format/size/UTF-8/preview/warning contract; this is
// its React equivalent, wired to the same POST /live-artifacts create path the picker-opened flow uses.
function HtmlImportDialog({ open, onClose, onConfirm }: {
  open: boolean;
  onClose(): void;
  onConfirm(input: { title: string; source: string }): void;
}) {
  const [preview, setPreview] = useState<HtmlImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = await readHtmlImportFile(file);
    if ('error' in result) { setError(result.error); setPreview(null); }
    else { setError(null); setPreview(result.preview); }
  }

  return (
    <FocusDialog open={open} onClose={onClose} title="Import HTML" description="Import a local HTML file as a private live artifact." testId="html-import-dialog">
      <input ref={inputRef} type="file" accept=".html,.htm" data-autofocus onChange={(event) => void onFileChange(event)} />
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <label>
            Title
            <input type="text" value={preview.title} onChange={(event) => setPreview({ ...preview, title: event.target.value })} />
          </label>
          <p role="alert">{IMPORT_WARNING}</p>
          <pre data-testid="html-import-source">{preview.source}</pre>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary-button" onClick={() => onConfirm(preview)}>Confirm import</button>
          </div>
        </>
      )}
    </FocusDialog>
  );
}

function LiveArtifactsWorkspace({
  route, artifactTabIds, liveArtifacts, userPreferences, currentUserId, listWorkspaceUsers,
}: {
  route: string;
  artifactTabIds: string[];
  liveArtifacts: LiveArtifactsGateway;
  userPreferences: UserPreferencesGateway;
  currentUserId: number;
  listWorkspaceUsers(): Promise<MessageThreadParticipant[]>;
}) {
  const [tabs, setTabs] = useState<ArtifactTab[]>([]);
  // Dashboard is always the initial selection — never the last-active artifact tab.
  const [selected, setSelected] = useState<string>('dashboard');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded: ArtifactTab[] = [];
      for (const id of artifactTabIds) {
        try {
          const detail = await liveArtifacts.get(id);
          loaded.push({ id, title: detail.title, status: 'ready', detail, html: null, frameUrl: null, errorMessage: null });
        } catch {
          // A restored tab whose artifact no longer loads is dropped rather than shown broken.
        }
      }
      if (active) setTabs(loaded);
    })();
    return () => { active = false; };
    // Seed exactly once per mounted identity — a real identity change always remounts this
    // component via a fresh sign-in, never via a prop change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const id = pendingFocusRef.current;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => focusTabId(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const order = ['dashboard', ...tabs.map((tab) => tab.id)];

  function focusTabId(id: string) {
    if (id === 'dashboard') dashboardRef.current?.focus();
    else tabRefs.current[id]?.focus();
  }

  function focusNeighbor(fromId: string, delta: number) {
    const index = order.indexOf(fromId);
    if (index === -1) return;
    focusTabId(order[(index + delta + order.length) % order.length]);
  }

  async function persistTabIds(ids: string[]) {
    try { await userPreferences.updateArtifactTabIds(ids); } catch { /* best-effort; UI stays the source of truth for this session */ }
  }

  async function loadTab(id: string) {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status: 'loading' } : tab)));
    try {
      const detail = await liveArtifacts.get(id);
      const rendered = await liveArtifacts.render(id);
      const frameUrl = nativeArtifactFrameUrl(id);
      const html = frameUrl ? null : rendered;
      setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status: 'ready', detail, html, frameUrl, title: detail.title, errorMessage: null } : tab)));
    } catch (error) {
      const { status, message } = mapError(error);
      setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status, errorMessage: message } : tab)));
    }
  }

  function selectTab(id: string) {
    setSelected(id);
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab && tab.html === null && tab.frameUrl === null) void loadTab(id);
  }

  async function openArtifact(id: string, title: string) {
    setPickerOpen(false);
    if (tabs.some((tab) => tab.id === id)) { setSelected(id); return; }
    const nextTabs = [...tabs, { id, title, status: 'loading' as TabStatus, detail: null, html: null, frameUrl: null, errorMessage: null }];
    setTabs(nextTabs);
    setSelected(id);
    await persistTabIds(nextTabs.map((tab) => tab.id));
    await loadTab(id);
  }

  async function confirmImport(input: { title: string; source: string }) {
    setImportOpen(false);
    // No dedicated "current workspace" endpoint exists yet — every artifact this user can already
    // see (via the catalog) shares their one workspace, so the first entry's workspaceId stands in
    // for it. ponytail: revisit if a user can legitimately have zero visible artifacts and still
    // needs to import their first one into a real (non-default) workspace.
    const existing = await liveArtifacts.list().catch(() => []);
    const workspaceId = existing[0]?.workspaceId ?? 1;
    const created = await liveArtifacts.create({
      type: 'html', title: input.title, workspaceId, visibility: 'private',
      bundle: { html: input.source, css: '', js: '' }, state: {},
    });
    await openArtifact(created.id, created.title);
  }

  function closeTab(id: string) {
    const index = order.indexOf(id);
    pendingFocusRef.current = order[index - 1] ?? 'dashboard';
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      void persistTabIds(next.map((tab) => tab.id));
      return next;
    });
    setSelected((current) => (current === id ? (order[index - 1] ?? 'dashboard') : current));
  }

  function handleTabKeyDown(event: KeyboardEvent, id: string) {
    if (event.key === 'ArrowRight') { event.preventDefault(); focusNeighbor(id, 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focusNeighbor(id, -1); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && id !== 'dashboard') { event.preventDefault(); closeTab(id); }
  }

  const activeTab = tabs.find((tab) => tab.id === selected);

  return (
    <div className="live-artifact-shell">
      <div className="artifact-tablist-row">
        <div role="tablist" aria-label="Dashboard artifacts" className="artifact-tablist">
          <div
            role="tab"
            aria-selected={selected === 'dashboard'}
            tabIndex={0}
            ref={dashboardRef}
            className="artifact-tab"
            onClick={() => setSelected('dashboard')}
            onKeyDown={(event) => handleTabKeyDown(event, 'dashboard')}
          >
            Dashboard
          </div>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected === tab.id}
              aria-label={tab.title}
              data-artifact-id={tab.id}
              tabIndex={0}
              ref={(element) => { tabRefs.current[tab.id] = element; }}
              className="artifact-tab"
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              <span className="artifact-tab-label">{tab.title}</span>
              <button type="button" className="artifact-tab-close" aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={() => setImportOpen(true)}>Import HTML</button>
        <button ref={addRef} type="button" className="artifact-tab-add" aria-label="Add live artifact" onClick={() => setPickerOpen(true)}>+</button>
      </div>

      <div className="artifact-tab-content">
        {/* Dashboard is a FIXED tab: it stays mounted (never unmounted/re-created) so its own
            in-progress state survives switching to an artifact tab and back — only visibility
            toggles. `hidden` keeps it attached to the DOM while removed from layout/a11y tree. */}
        <div hidden={selected !== 'dashboard'} className="artifact-dashboard-pane">
          <DashboardPage route={route} />
        </div>
        {activeTab && selected !== 'dashboard' && (
          <LiveArtifactSurface
            tab={activeTab}
            onReload={() => void loadTab(activeTab.id)}
            isOwner={activeTab.detail?.ownerUserId === currentUserId}
            liveArtifacts={liveArtifacts}
            listWorkspaceUsers={listWorkspaceUsers}
          />
        )}
      </div>

      <ArtifactPicker open={pickerOpen} onClose={() => setPickerOpen(false)} gateway={liveArtifacts} onSelect={(id, title) => void openArtifact(id, title)} />
      <HtmlImportDialog open={importOpen} onClose={() => setImportOpen(false)} onConfirm={(input) => void confirmImport(input)} />
    </div>
  );
}

// Live-mode wrapper: Dashboard becomes a fixed tab beside dynamic, stable-ID artifact tabs opened
// from a searchable HTML-only picker (post-m1-phase-8 c1a-c1f). Fixture mode and any live harness
// that authenticates via the test-only token (no signed-in AuthUser) fall through to the bare
// Dashboard unchanged — this must never regress the existing fixture artifact panel or phase-3/4
// live coverage.
export function LiveArtifactsShell({ route }: { route: string }) {
  const gateway = useGateway();
  const authUser = useAuthUser();
  const liveArtifacts = gateway.domains.liveArtifacts;
  const userPreferences = gateway.domains.userPreferences;
  const messages = gateway.domains.messages;
  if (gateway.mode !== 'live' || !authUser || !liveArtifacts || !userPreferences || !messages) {
    return <DashboardPage route={route} />;
  }
  return (
    <LiveArtifactsWorkspace
      key={authUser.user.id}
      route={route}
      artifactTabIds={authUser.user.artifactTabIds ?? []}
      liveArtifacts={liveArtifacts}
      userPreferences={userPreferences}
      currentUserId={authUser.user.id}
      listWorkspaceUsers={() => messages.users()}
    />
  );
}
