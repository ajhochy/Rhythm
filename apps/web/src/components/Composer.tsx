import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useGateway } from '../gateway/context';
import { useAuthUser } from '../gateway/auth';
import {
  matchesSendMessageKey,
  readLocalUserPreferences,
  sendMessageKeyLabel,
  USER_PREFERENCES_CHANGED_EVENT,
  type SendMessageKey,
} from '../gateway/user-preferences';
import { isSessionOffline } from '../sessionState';
import { useFixtures } from '../store';
import type { ComposerAttachment } from '../types';
import type { CommandEntry } from '../gateway/commands';
import type { SessionSettings } from '../gateway/sessions';
import { FocusDialog } from './FocusDialog';

const slashCommands = ['/summarize', '/review', '/status', '/compact'];
// post-m1-phase-5 c1e: canonical PermissionMode values persisted across the PATCH boundary —
// apps/api_server/src/models/agent_session.ts:24,26,92. Fixture mode keeps its own display-string
// values (never sent over the wire) so its local-only state is untouched.
const livePermissionModeOptions: Array<{ value: string; label: string }> = [
  { value: 'default', label: 'Default' }, { value: 'acceptEdits', label: 'Accept Edits' }, { value: 'plan', label: 'Plan' }, { value: 'bypassPermissions', label: 'Bypass' },
];
const fixturePermissionModeOptions: Array<{ value: string; label: string }> = [
  { value: 'Default', label: 'Default' }, { value: 'Accept Edits', label: 'Accept Edits' }, { value: 'Plan', label: 'Plan' }, { value: 'Bypass', label: 'Bypass' },
];
type FileFixture = { id: string; path: string; mime: string; size: number; outcome: 'text' | 'large-text' | 'binary' | 'unsafe' | 'missing'; description: string };
const fileFixtures: FileFixture[] = [
  { id: 'allowed', path: 'services/2026-08-16/run-sheet.md', mime: 'text/markdown', size: 184, outcome: 'text', description: 'Text · 184 bytes' },
  { id: 'large', path: 'exports/full-transcript.json', mime: 'application/json', size: 2_400_001, outcome: 'large-text', description: 'Text · first 100 KB will be attached' },
  { id: 'binary', path: 'build/rhythm-agent', mime: 'application/octet-stream', size: 68_412, outcome: 'binary', description: 'Binary · safe local file reference' },
  { id: 'unsafe', path: '../../outside.rhythmfixture', mime: 'application/octet-stream', size: 48, outcome: 'unsafe', description: 'Traversal-shaped path · rejected' },
  { id: 'missing', path: 'docs/missing-context.md', mime: 'text/markdown', size: 0, outcome: 'missing', description: 'Missing fixture · recovery state' },
];

const MAX_LIVE_TEXT_ATTACHMENT_CHARS = 100 * 1024;
// post-m1-phase-6 c1e: the existing API-side session.input.parts size boundary
// (apps/api_server/src/services/ws_gateway.ts), driven through React pre-flight so a too-large
// selection never reaches the provider and the composer keeps the file for a retry.
const MAX_LIVE_PARTS_BYTES = 20 * 1024 * 1024;

// c2e: resolves a real, user-selected File into a canonical composer attachment. Text-shaped
// files become inline text content (truncated like Flutter's 100 KB cap); image/PDF files
// become a data: URL file part. A browser file input cannot resolve a real filesystem path
// (unlike Flutter's native picker), so any other binary type gets a name-only reference.
async function resolveLiveAttachment(file: File): Promise<ComposerAttachment> {
  const mime = file.type || 'application/octet-stream';
  const id = `attachment-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (mime.startsWith('text/') || mime === 'application/json') {
    const full = await file.text();
    const truncated = full.length > MAX_LIVE_TEXT_ATTACHMENT_CHARS;
    return { id, type: 'text', path: file.name, filename: file.name, mime, size: file.size, truncated, content: truncated ? full.slice(0, MAX_LIVE_TEXT_ATTACHMENT_CHARS) : full };
  }
  if (mime.startsWith('image/') || mime === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    return { id, type: 'file', path: file.name, filename: file.name, mime, size: file.size, dataUrl };
  }
  // ponytail: browser file inputs cannot resolve a real filesystem path; best-effort
  // name-only reference. Upgrade if/when an Electron/native picker is wired in.
  return { id, type: 'file', path: file.name, filename: file.name, mime, size: file.size, fileUrl: `file:${file.name}` };
}

function mentionMatch(value: string) {
  return value.match(/(?:^|\s)@([^\s@]*)$/);
}

export function Composer() {
  const { selected, profiles, models, catalogError, turnOverride, stageTurnOverride, saveSessionSettings, sendInput, sendLiveInput, sendLiveCommand, sessionGatewayMode, cancelSession, reconnect, updateSession, runShell, notify, liveChildView } = useFixtures();
  const gateway = useGateway();
  const auth = useAuthUser();
  const preferenceUserId = auth?.user.id ?? 'fixture';
  const [sendKey, setSendKey] = useState<SendMessageKey>(() => readLocalUserPreferences(preferenceUserId).sendKey);
  const [draft, setDraft] = useState('');
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const live = sessionGatewayMode === 'live';
  const selectedModel = turnOverride.modelOverride ?? { providerId: selected.providerId, modelId: selected.modelId };
  const modelKey = selectedModel.providerId && selectedModel.modelId ? `${selectedModel.providerId}/${selectedModel.modelId}` : '';
  const persist = async (input: SessionSettings) => {
    setSettingsError('');
    try { await saveSessionSettings(selected.id, input); notify('Session settings saved and read back'); return true; }
    catch (error) { setSettingsError(error instanceof Error ? error.message : 'Session settings failed'); return false; }
  };
  const applyModel = async (scope: 'turn' | 'session') => {
    if (!pendingModel) return;
    if (!live) { updateSession(selected.id, { model: pendingModel }); setPendingModel(null); return; }
    const choice = models.find(model => `${model.providerId}/${model.modelId}` === pendingModel);
    if (!choice) { setSettingsError('Selected model is unavailable'); return; }
    const modelOverride = { providerId: choice.providerId, modelId: choice.modelId };
    if (scope === 'turn') { stageTurnOverride({ modelOverride }); notify('Model staged for this turn only'); }
    else if (!await persist(modelOverride)) return;
    setPendingModel(null);
  };
  const [bypassConfirm, setBypassConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachmentFeedback, setAttachmentFeedback] = useState('');
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [mentionState, setMentionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [commandsUnavailable, setCommandsUnavailable] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // c2e: real File objects selected via a live-only file input, resolved into canonical
  // parts at submit time (not on selection) so a fast composer-send click can never race
  // ahead of the async FileReader work — see resolveLiveAttachment above.
  const [filesBySession, setFilesBySession] = useState<Record<string, File[]>>({});
  const liveFiles = filesBySession[selected.id] ?? [];
  const setLiveFiles = (next: File[] | ((current: File[]) => File[])) => setFilesBySession((current) => ({
    ...current, [selected.id]: typeof next === 'function' ? next(current[selected.id] ?? []) : next,
  }));
  // post-m1-phase-6 c1b: real server-side `@` search results (relative paths) and the
  // canonical attachments resolved from choosing one — kept separate from `liveFiles`
  // (real browser File objects) since these already arrive as resolved content, not bytes.
  const [liveMentionResults, setLiveMentionResults] = useState<string[]>([]);
  const [mentionsBySession, setMentionsBySession] = useState<Record<string, ComposerAttachment[]>>({});
  const liveMentionAttachments = mentionsBySession[selected.id] ?? [];
  // Capture the originating render's ID, including when fileContent resolves after navigation.
  const setLiveMentionAttachments = (next: ComposerAttachment[] | ((current: ComposerAttachment[]) => ComposerAttachment[])) => setMentionsBySession((current) => ({
    ...current, [selected.id]: typeof next === 'function' ? next(current[selected.id] ?? []) : next,
  }));
  const activeContext = useRef({ id: selected.id, child: Boolean(liveChildView) });
  activeContext.current = { id: selected.id, child: Boolean(liveChildView) };
  // post-m1-phase-5 c3g: live slash commands replace the fixture's four hard-coded
  // suggestions and dispatch as their own session.command WS frame — GET /opencode/commands,
  // apps/api_server/src/routes/opencode_commands_routes.ts:41-60.
  const [liveCommands, setLiveCommands] = useState<CommandEntry[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const attachments = selected.pendingAttachments ?? [];

  useEffect(() => {
    setDraft(selected.queuedDraft || ''); setPickerOpen(false); setAttachmentFeedback(''); setSuggestionsDismissed(false); setHighlighted(0);
  }, [selected.id, selected.queuedDraft]);
  useEffect(() => { setPendingModel(null); setPendingProfile(null); setSettingsError(''); }, [selected.id]);
  useEffect(() => {
    const syncSendKey = () => setSendKey(readLocalUserPreferences(preferenceUserId).sendKey);
    syncSendKey();
    window.addEventListener('storage', syncSendKey);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, syncSendKey);
    return () => {
      window.removeEventListener('storage', syncSendKey);
      window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, syncSendKey);
    };
  }, [preferenceUserId]);
  useEffect(() => {
    if (!pickerOpen) return;
    const outside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !attachButtonRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPickerOpen(false); attachButtonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', keyboard); };
  }, [pickerOpen]);

  const offline = isSessionOffline(selected);
  // Persisted children are interactive local sessions; only ephemeral live views are read-only.
  const recoverableSdk = sessionGatewayMode === 'live' && Boolean(selected.sdkSessionId);
  const disabledReason = (liveChildView || sessionGatewayMode !== 'live' && selected.parentId)
    ? 'Child-agent transcripts are read only.'
    : selected.group === 'archived'
      ? 'Archived sessions cannot accept input.'
      : selected.completedAt && !recoverableSdk
        ? 'Resume this completed session before sending.'
        : (selected.status === 'closed' || selected.status === 'error') && !recoverableSdk
          ? 'This run has ended. Resume it or start fresh if its runtime session is unavailable.'
          : '';
  const atMatch = mentionMatch(draft);
  const atQuery = atMatch?.[1].toLowerCase() ?? '';
  const mentionOptions = useMemo(() => fileFixtures.filter((file) => file.path.toLowerCase().includes(atQuery)), [atQuery]);
  const suggestionType = disabledReason || suggestionsDismissed ? null : draft.startsWith('/') ? 'slash' : atMatch ? 'mention' : draft.startsWith('!') ? 'shell' : null;
  const slashOptions = sessionGatewayMode === 'live'
    ? liveCommands.map((command) => `/${command.name}`).filter((command) => command.startsWith(draft))
    : slashCommands.filter((command) => command.startsWith(draft));
  const liveCommandNames = useMemo(() => new Set(liveCommands.map((command) => command.name)), [liveCommands]);
  const suggestionCount = suggestionType === 'mention' ? (sessionGatewayMode === 'live' ? liveMentionResults.length : mentionOptions.length) : suggestionType === 'slash' ? slashOptions.length : suggestionType === 'shell' ? 1 : 0;

  useEffect(() => { setHighlighted(0); }, [suggestionType, atQuery, draft.startsWith('/')]);
  useEffect(() => {
    suggestionsRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  // post-m1-phase-6 c1b: debounced server-side `@` search — apps/api_server/src/routes/agent_sessions_routes.ts:86,
  // controller.findFiles at apps/api_server/src/controllers/agent_sessions_controller.ts:2441-2454 (query/limit/type).
  useEffect(() => {
    if (sessionGatewayMode !== 'live' || suggestionType !== 'mention' || !atQuery.trim()) { setLiveMentionResults([]); setMentionState('idle'); return; }
    setMentionState('loading');
    let active = true;
    const timer = window.setTimeout(() => {
      void gateway.domains.sessions!.findFiles(selected.id, atQuery, { limit: 20, type: 'file' })
        .then((paths) => { if (active) { setLiveMentionResults(paths); setMentionState('ready'); } })
        .catch(() => { if (active) { setLiveMentionResults([]); setMentionState('error'); } });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [sessionGatewayMode, suggestionType, atQuery, selected.id, gateway]);

  useEffect(() => {
    if (sessionGatewayMode !== 'live') { setLiveCommands([]); setCommandsUnavailable(false); return; }
    let active = true;
    void gateway.domains.commands!.list().then((commands) => { if (active) { setLiveCommands(commands); setCommandsUnavailable(false); } }).catch(() => { if (active) { setLiveCommands([]); setCommandsUnavailable(true); } });
    return () => { active = false; };
  }, [sessionGatewayMode, gateway]);

  // c1b: resolves a chosen server search result into a canonical attachment via a real
  // session-scoped content fetch — never retains the transient dropdown/display token.
  const chooseLiveMention = (path: string) => {
    const match = mentionMatch(draft);
    if (match && match.index !== undefined) setDraft(`${draft.slice(0, match.index)}${draft.slice(match.index + match[0].length)}`.trimStart());
    setSuggestionsDismissed(false);
    const filename = path.split('/').at(-1) ?? path;
    void gateway.domains.sessions!.fileContent(selected.id, path).then((content) => {
      const id = `attachment-live-mention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const attachment: ComposerAttachment = typeof content.content === 'string'
        ? { id, type: 'text', path, filename, mime: content.mimeType || 'text/plain', size: content.content.length, content: content.content }
        : { id, type: 'file', path, filename, mime: content.mimeType || 'application/octet-stream', size: 0, fileUrl: `file:${path}` };
      setLiveMentionAttachments((current) => [...current, attachment]);
      if (activeContext.current.id === selected.id && !activeContext.current.child) { setAttachmentFeedback(`${filename} attached.`); notify(`${filename} attached`); }
    }).catch(() => { if (activeContext.current.id === selected.id && !activeContext.current.child) { setAttachmentFeedback(`Could not attach ${filename}.`); notify(`Could not attach ${filename}`); } });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addFixture = (file: FileFixture) => {
    setAttachmentFeedback('');
    if (file.outcome === 'unsafe') {
      const message = `Could not attach ${file.path}: PATH_TRAVERSAL.`;
      setAttachmentFeedback(message); notify(message); return false;
    }
    if (file.outcome === 'missing') {
      const message = `Could not attach ${file.path}: file not found.`;
      setAttachmentFeedback(message); notify(message); return false;
    }
    if (attachments.some((attachment) => attachment.path === file.path)) {
      const message = `${file.path} is already attached.`;
      setAttachmentFeedback(message); notify(message); return true;
    }
    const filename = file.path.split('/').at(-1) ?? file.path;
    const attachment: ComposerAttachment = {
      id: `attachment-${file.id}`,
      type: file.outcome === 'binary' ? 'file' : 'text',
      path: file.path,
      filename,
      mime: file.mime,
      size: file.outcome === 'large-text' ? 100 * 1024 : file.size,
      truncated: file.outcome === 'large-text',
      fileUrl: file.outcome === 'binary' ? `file:///workspace/rhythm/${file.path}` : undefined,
    };
    updateSession(selected.id, { pendingAttachments: [...attachments, attachment] });
    const message = attachment.truncated
      ? `${filename} attached · truncated to the first 100 KB.`
      : attachment.type === 'file'
        ? `${filename} attached as a safe local file reference.`
        : `${filename} attached.`;
    setAttachmentFeedback(message); notify(message); return true;
  };

  const removeAttachment = (id: string) => {
    const attachment = attachments.find((item) => item.id === id);
    updateSession(selected.id, { pendingAttachments: attachments.filter((item) => item.id !== id) });
    setAttachmentFeedback(`${attachment?.filename ?? 'File'} removed.`); notify('Fixture attachment removed');
  };

  const chooseMention = (file: FileFixture) => {
    const match = mentionMatch(draft);
    if (match && match.index !== undefined) setDraft(`${draft.slice(0, match.index)}${draft.slice(match.index + match[0].length)}`.trimStart());
    addFixture(file); setSuggestionsDismissed(false); requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const submit = async () => {
    if (disabledReason) { notify(disabledReason); return; }
    const value = draft.trim();
    if (sessionGatewayMode === 'live') {
      if (!value && liveFiles.length === 0 && liveMentionAttachments.length === 0) { notify('Enter a message or attach a file before sending'); textareaRef.current?.focus(); return; }
      // post-m1-phase-5 c3g: a recognized live command dispatches its own WS frame — never
      // folded into session.input as free text, even when it carries argument text.
      const commandMatch = value.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
      if (commandMatch && liveCommandNames.has(commandMatch[1])) {
        sendLiveCommand(commandMatch[1], commandMatch[2] ?? '');
        setLiveFiles([]); setLiveMentionAttachments([]); setDraft(''); setAttachmentFeedback('');
        return;
      }
      const oversized = liveFiles.find((file) => file.size > MAX_LIVE_PARTS_BYTES);
      if (oversized) {
        const message = `Could not send: ${oversized.name} is larger than the 20 MiB limit.`;
        setAttachmentFeedback(message); notify(message); return;
      }
      const resolved = [...liveMentionAttachments, ...await Promise.all(liveFiles.map(resolveLiveAttachment))];
      if (activeContext.current.id !== selected.id || activeContext.current.child) return;
      if (value.startsWith('\\!')) sendLiveInput(value.slice(1), resolved);
      else if (value.startsWith('!')) { runShell(value.slice(1).trim()); notify('Shell command completed in the fixture terminal'); }
      else sendLiveInput(value, resolved);
      // A resolved text attachment's real content is what the agent actually received —
      // surface a preview of it (after sendLiveInput's own generic notify) so the sender can
      // confirm what was delivered instead of a content-free "Message sent".
      const textPreview = resolved.find((attachment) => attachment.content !== undefined)?.content;
      if (textPreview) notify(`Message sent · attached: ${textPreview.slice(0, 200)}`);
      setLiveFiles([]); setLiveMentionAttachments([]); setDraft(''); setAttachmentFeedback('');
      return;
    }
    if (!value && attachments.length === 0) { notify('Enter a message or attach a file before sending'); textareaRef.current?.focus(); return; }
    if (value.startsWith('\\!')) sendInput(value.slice(1), attachments);
    else if (value.startsWith('!')) { runShell(value.slice(1).trim()); notify('Shell command completed in the fixture terminal'); }
    else sendInput(value, attachments);
    setDraft(''); setAttachmentFeedback('');
  };

  const useHighlightedSuggestion = () => {
    if (suggestionType === 'mention' && sessionGatewayMode === 'live') { if (liveMentionResults[highlighted]) chooseLiveMention(liveMentionResults[highlighted]); }
    else if (suggestionType === 'mention' && mentionOptions[highlighted]) chooseMention(mentionOptions[highlighted]);
    else if (suggestionType === 'slash' && slashOptions[highlighted]) { setDraft(`${slashOptions[highlighted]} `); requestAnimationFrame(() => textareaRef.current?.focus()); }
    else if (suggestionType === 'shell') { setDraft('!git status --short'); requestAnimationFrame(() => textareaRef.current?.focus()); }
  };

  const handleComposerKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestionType && event.key === 'Escape') { event.preventDefault(); setSuggestionsDismissed(true); return; }
    if (suggestionType && suggestionCount > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); setHighlighted((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + suggestionCount) % suggestionCount); return;
    }
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (suggestionType && suggestionCount > 0 && event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); useHighlightedSuggestion(); return; }
    if (matchesSendMessageKey(event, sendKey)) { event.preventDefault(); void submit(); }
  };

  return (
    <form className={`composer ${offline ? 'offline' : ''}`} aria-label="Message composer" onSubmit={(event) => { event.preventDefault(); void submit(); }} data-od-id="agent-composer">
      {live && (settingsError || catalogError) && <p role="alert">{settingsError || catalogError}</p>}
      {live && (turnOverride.profileId || turnOverride.modelOverride) && <p role="status">Next turn only: {profiles.find(p => p.id === turnOverride.profileId)?.label} {turnOverride.modelOverride?.modelId}</p>}
      {offline && <div className="offline-queue" role="status" data-testid="offline-queue"><span><Icon name="background" size={15} /><strong>Desktop offline</strong> · input remains local until you reconnect.</span><button className="secondary-button" type="button" onClick={reconnect} data-testid="reconnect-button"><Icon name="refresh" size={14} />Reconnect &amp; flush</button></div>}
      {disabledReason && <div className="composer-disabled-reason" role="status"><Icon name="background" size={14} />{disabledReason}</div>}
      {attachments.length > 0 && <div className="attachment-list" role="region" aria-label="Pending attachments" data-testid="attachment-list">{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id} data-testid={`attachment-${attachment.id.replace('attachment-', '')}`}><Icon name={attachment.type === 'file' ? 'command' : 'file'} size={14} /><span><strong>{attachment.filename}</strong><small>{attachment.truncated ? 'first 100 KB · truncated' : attachment.type === 'file' ? 'local file reference' : attachment.mime}</small></span><button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.filename}`} disabled={Boolean(disabledReason)} data-testid={`attachment-remove-${attachment.id.replace('attachment-', '')}`}><Icon name="close" size={13} /></button></div>)}</div>}
      {sessionGatewayMode === 'live' && (liveFiles.length > 0 || liveMentionAttachments.length > 0) && <div className="attachment-list" role="region" aria-label="Pending attachments" data-testid="live-attachment-list">
        {liveMentionAttachments.map((attachment) => <div className="attachment-chip" key={attachment.id} data-testid={`live-mention-${attachment.id}`}><Icon name={attachment.type === 'file' ? 'command' : 'file'} size={14} /><span><strong>{attachment.filename}</strong><small>{attachment.mime}</small></span><button type="button" onClick={() => setLiveMentionAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.filename}`}><Icon name="close" size={13} /></button></div>)}
        {liveFiles.map((file, index) => <div className="attachment-chip" key={`${file.name}-${index}`} data-testid={`live-attachment-${index}`}><Icon name="file" size={14} /><span><strong>{file.name}</strong><small>{file.type || 'application/octet-stream'}</small></span><button type="button" onClick={() => setLiveFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><Icon name="close" size={13} /></button></div>)}
      </div>}
      {attachmentFeedback && <div className={`attachment-feedback ${attachmentFeedback.startsWith('Could not') ? 'error' : ''}`} id="composer-attachment-feedback" role={attachmentFeedback.startsWith('Could not') ? 'alert' : 'status'} data-testid="attachment-feedback"><span>{attachmentFeedback}</span>{attachmentFeedback.startsWith('Could not') && <button type="button" className="text-button" onClick={() => { setAttachmentFeedback(''); textareaRef.current?.focus(); }}>Dismiss</button>}</div>}
      <label className="composer-label" htmlFor="composer-input">Message the agent</label>
      <div className="composer-input-row">
        <textarea id="composer-input" ref={textareaRef} value={draft} onChange={(event) => { setDraft(event.target.value); setSuggestionsDismissed(false); }} onKeyDown={handleComposerKey} placeholder="Message the agent · / command · @ file · ! shell" rows={2} role="combobox" aria-autocomplete="list" aria-controls="composer-suggestions-list" aria-expanded={Boolean(suggestionType)} aria-activedescendant={suggestionType && suggestionCount > 0 ? `composer-${suggestionType}-option-${highlighted}` : undefined} aria-describedby={`composer-help${attachmentFeedback ? ' composer-attachment-feedback' : ''}`} disabled={Boolean(disabledReason)} data-testid="composer-input" />
        {selected.status === 'working' && !offline
          // Pre-existing gotcha (unrelated to Phase 4 attachments/streaming/parts/pagination):
          // without distinct `key`s, React patches this button's `type` in place (button→submit)
          // instead of remounting it. When cancelSession's click handler flips status, the DOM
          // node's type attribute mutates to "submit" before the browser's native default action
          // for that same click runs — silently firing a second, empty form submit right after
          // cancel. Distinct keys force a real remount so the swap can't hijack the click.
          ? <button key="composer-cancel" className="danger-icon-button" type="button" onClick={() => cancelSession(selected.id)} aria-label="Cancel running session" data-testid="composer-cancel" disabled={Boolean(disabledReason)}><Icon name="cancel" size={15} /></button>
          : <button key="composer-send" className="send-button" type="submit" aria-label={offline ? 'Queue draft locally' : 'Send message'} data-testid="composer-send" disabled={Boolean(disabledReason)}><Icon name="send" size={17} /></button>}
      </div>
      {suggestionType && <div ref={suggestionsRef} id="composer-suggestions-list" className="composer-suggestions" role="listbox" aria-label={`${suggestionType} suggestions`} data-testid="composer-suggestions">
        {suggestionType === 'slash' && slashOptions.map((command, index) => <button id={`composer-slash-option-${index}`} role="option" aria-selected={highlighted === index} type="button" key={command} onClick={() => { setDraft(`${command} `); textareaRef.current?.focus(); }} data-testid={`command-${command.slice(1)}`}><Icon name="command" size={14} /><strong>{command}</strong><small>{sessionGatewayMode === 'live' ? (liveCommands.find((entry) => entry.name === command.slice(1))?.description || 'Command') : 'Fixture command'}</small></button>)}
        {suggestionType === 'slash' && sessionGatewayMode === 'live' && commandsUnavailable && <div className="suggestion-empty" role="status">Commands are unavailable. Try again after reconnecting.</div>}
        {suggestionType === 'slash' && sessionGatewayMode === 'live' && !commandsUnavailable && slashOptions.length === 0 && <div className="suggestion-empty" role="status">No matching commands</div>}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && liveMentionResults.map((path, index) => <button id={`composer-mention-option-${index}`} role="option" aria-selected={highlighted === index} type="button" key={path} onClick={() => chooseLiveMention(path)} data-testid={`mention-option-live-${index}`}><Icon name="file" size={14} /><strong>{path}</strong></button>)}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && mentionState === 'loading' && <div className="suggestion-empty" role="status">Searching files…</div>}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && mentionState === 'error' && <div className="suggestion-empty" role="alert">File search is unavailable. Try again after reconnecting.</div>}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && mentionState === 'ready' && liveMentionResults.length === 0 && <div className="suggestion-empty" role="status" data-testid="mention-no-results">No matching files</div>}
        {suggestionType === 'mention' && sessionGatewayMode !== 'live' && mentionOptions.map((file, index) => <button id={`composer-mention-option-${index}`} role="option" aria-selected={highlighted === index} type="button" key={file.id} onClick={() => chooseMention(file)} data-testid={`mention-option-${file.id}`}><Icon name="file" size={14} /><strong>{file.path}</strong><small>{file.description}</small></button>)}
        {suggestionType === 'mention' && sessionGatewayMode !== 'live' && mentionOptions.length === 0 && <div className="suggestion-empty" role="status" data-testid="mention-no-results">No matching files</div>}
        {suggestionType === 'shell' && <button id="composer-shell-option-0" role="option" aria-selected="true" type="button" onClick={() => { setDraft('!git status --short'); textareaRef.current?.focus(); }} data-testid="shell-shortcut-option"><Icon name="terminal" size={14} /><strong>!git status --short</strong><small>Run through session shell</small></button>}
      </div>}
      <div className="composer-toolbar">
        <div className="composer-selects">
          <label><span className="sr-only">Agent</span><select value={live ? turnOverride.profileId ?? selected.profileId : selected.profileId} onChange={(event) => { if (live) setPendingProfile(event.target.value); else { const profile = profiles.find((item) => item.id === event.target.value); updateSession(selected.id, { profileId: event.target.value, model: profile?.model || selected.model }); } }} data-testid="composer-profile" disabled={Boolean(disabledReason) || live && !selected.id}><option value="" disabled>Choose agent</option>{profiles.filter((profile) => profile.enabled && profile.selectable && (!live || !profile.id.startsWith('profile-created-'))).map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label>
          <label><span className="sr-only">Model</span><select value={live ? modelKey : selected.model} onChange={(event) => setPendingModel(event.target.value)} data-testid="composer-model" disabled={Boolean(disabledReason) || live && (!selected.id || !models.length)}>{live ? <><option value="" disabled>Session model default</option>{modelKey && !models.some(m => `${m.providerId}/${m.modelId}` === modelKey) && <option value={modelKey} disabled>{modelKey} (unavailable)</option>}{models.map(m => <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>{m.label} · {m.providerId}</option>)}</> : <><option>gpt-5.6</option><option>gpt-5.6-codex</option><option>claude-sonnet-4</option></>}</select></label>
          <label><span className="sr-only">Permission mode</span><select value={selected.permissionMode} onChange={(event) => { const bypassValue = live ? 'bypassPermissions' : 'Bypass'; if (event.target.value === bypassValue) setBypassConfirm(true); else if (live) void persist({ permissionMode: event.target.value }); else updateSession(selected.id, { permissionMode: event.target.value }); }} data-testid="composer-permission-mode" disabled={Boolean(disabledReason) || live && !selected.id}>{(live ? livePermissionModeOptions : fixturePermissionModeOptions).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label><span className="sr-only">Reasoning budget</span>{live ? <input type="number" min="0" step="1" key={`${selected.id}-${selected.thinkingBudget}`} defaultValue={selected.thinkingBudget} placeholder="Default budget" onBlur={event => { if (event.target.checkValidity() && event.target.value !== selected.thinkingBudget) void persist({ thinkingBudget: event.target.value === '' ? null : Number(event.target.value) }); }} data-testid="composer-thinking" disabled={Boolean(disabledReason) || !selected.id} /> : <select value={selected.thinkingBudget} onChange={(event) => updateSession(selected.id, { thinkingBudget: event.target.value })} data-testid="composer-thinking" disabled={Boolean(disabledReason)}><option>Off</option><option>Low</option><option>Medium</option><option>High</option><option>X-High</option><option>Max</option></select>}</label>
          <button className={`toggle-button ${selected.fastMode ? 'active' : ''}`} type="button" aria-pressed={selected.fastMode} onClick={() => { if (live) void persist({ fastMode: !selected.fastMode }); else updateSession(selected.id, { fastMode: !selected.fastMode }); }} data-testid="composer-fast" disabled={Boolean(disabledReason) || live && !selected.id}><Icon name="activity" size={13} />Fast</button>
          {sessionGatewayMode === 'live'
            ? <label className="icon-button small live-file-label" aria-label="Attach files" data-testid="composer-attach"><Icon name="attach" size={15} /><input type="file" multiple className="sr-only" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length > 0) setLiveFiles((current) => [...current, ...files]); event.target.value = ''; }} disabled={Boolean(disabledReason)} data-testid="composer-live-file-input" /></label>
            : <div className="attachment-picker-anchor"><button ref={attachButtonRef} className="icon-button small" type="button" onClick={() => setPickerOpen((value) => !value)} aria-label="Attach files" aria-haspopup="menu" aria-expanded={pickerOpen} data-testid="composer-attach" disabled={Boolean(disabledReason)}><Icon name="attach" size={15} /></button>{pickerOpen && <div ref={pickerRef} className="attachment-picker menu-popover" role="menu" aria-label="Fixture files" data-testid="attachment-picker"><div className="menu-heading"><span>Attach files</span><small>Local fixture</small></div>{fileFixtures.map((file) => <button className="menu-item stacked" role="menuitem" type="button" key={file.id} onClick={() => { addFixture(file); setPickerOpen(false); requestAnimationFrame(() => attachButtonRef.current?.focus()); }} data-testid={`attachment-option-${file.id}`}><Icon name={file.outcome === 'binary' ? 'command' : 'file'} size={14} /><span><strong>{file.path}</strong><small>{file.description}</small></span></button>)}</div>}</div>}
        </div>
        <small id="composer-help">{sendKey === 'Enter' ? 'Enter to send · Shift+Enter for newline' : `${sendMessageKeyLabel(sendKey)} to send · Enter for newline`}</small>
      </div>
      <FocusDialog open={Boolean(pendingProfile)} onClose={() => setPendingProfile(null)} title="Apply agent selection" description="Use this agent for one turn or save it as the session default." testId="agent-scope-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPendingProfile(null)}>Cancel</button><button className="secondary-button" type="button" data-testid="agent-this-turn" onClick={() => { if (pendingProfile) stageTurnOverride({ profileId: pendingProfile }); setPendingProfile(null); }}>This turn only</button><button className="primary-button" type="button" data-testid="agent-session-default" onClick={() => { if (pendingProfile) void persist({ profileId: pendingProfile }).then(ok => { if (ok) setPendingProfile(null); }); }}>Session default</button></div>{settingsError && <p role="alert">{settingsError}</p>}</FocusDialog>
      <FocusDialog open={Boolean(pendingModel)} onClose={() => setPendingModel(null)} title="Apply model selection" description={pendingModel ? `Use ${pendingModel} for this prompt or make it the session default.` : ''} testId="model-scope-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPendingModel(null)}>Cancel</button><button className="secondary-button" type="button" onClick={() => void applyModel('turn')} data-testid="model-this-turn">This turn only</button><button className="primary-button" type="button" onClick={() => void applyModel('session')} data-testid="model-session-default">Session default</button></div>{settingsError && <p role="alert">{settingsError}</p>}</FocusDialog>
      <FocusDialog open={bypassConfirm} onClose={() => setBypassConfirm(false)} title="Bypass all permissions?" description="The agent can run tools without asking. Use this only in a trusted workspace." testId="bypass-confirm-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setBypassConfirm(false)}>Cancel</button><button className="danger-button" type="button" onClick={() => { if (live) void persist({ permissionMode: 'bypassPermissions' }).then(ok => { if (ok) setBypassConfirm(false); }); else { updateSession(selected.id, { permissionMode: 'Bypass' }); setBypassConfirm(false); notify('Bypass permission mode enabled'); } }} data-testid="bypass-confirm">Enable Bypass</button></div>{settingsError && <p role="alert">{settingsError}</p>}</FocusDialog>
    </form>
  );
}
