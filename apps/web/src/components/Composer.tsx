import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useGateway } from '../gateway/context';
import { isSessionOffline } from '../sessionState';
import { useFixtures } from '../store';
import type { ComposerAttachment } from '../types';
import { FocusDialog } from './FocusDialog';

const slashCommands = ['/summarize', '/review', '/status', '/compact'];
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
  const { selected, profiles, sendInput, sendLiveInput, sessionGatewayMode, cancelSession, reconnect, updateSession, runShell, notify } = useFixtures();
  const gateway = useGateway();
  const [draft, setDraft] = useState('');
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [bypassConfirm, setBypassConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachmentFeedback, setAttachmentFeedback] = useState('');
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // c2e: real File objects selected via a live-only file input, resolved into canonical
  // parts at submit time (not on selection) so a fast composer-send click can never race
  // ahead of the async FileReader work — see resolveLiveAttachment above.
  const [liveFiles, setLiveFiles] = useState<File[]>([]);
  // post-m1-phase-6 c1b: real server-side `@` search results (relative paths) and the
  // canonical attachments resolved from choosing one — kept separate from `liveFiles`
  // (real browser File objects) since these already arrive as resolved content, not bytes.
  const [liveMentionResults, setLiveMentionResults] = useState<string[]>([]);
  const [liveMentionAttachments, setLiveMentionAttachments] = useState<ComposerAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const attachments = selected.pendingAttachments ?? [];

  useEffect(() => {
    setDraft(selected.queuedDraft || ''); setPickerOpen(false); setAttachmentFeedback(''); setMentionDismissed(false); setHighlighted(0);
  }, [selected.id, selected.queuedDraft]);
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
  const disabledReason = selected.parentId
    ? 'Child-agent transcripts are read only.'
    : selected.group === 'archived'
      ? 'Archived sessions cannot accept input.'
      : selected.completedAt
        ? 'Resume this completed session before sending.'
        : selected.status === 'closed' || selected.status === 'error'
          ? "This run has ended and can't be resumed."
          : '';
  const atMatch = mentionMatch(draft);
  const atQuery = atMatch?.[1].toLowerCase() ?? '';
  const mentionOptions = useMemo(() => fileFixtures.filter((file) => file.path.toLowerCase().includes(atQuery)), [atQuery]);
  const suggestionType = disabledReason ? null : draft.startsWith('/') ? 'slash' : atMatch && !mentionDismissed ? 'mention' : draft.startsWith('!') ? 'shell' : null;
  const slashOptions = slashCommands.filter((command) => command.startsWith(draft));
  const suggestionCount = suggestionType === 'mention' ? (sessionGatewayMode === 'live' ? liveMentionResults.length : mentionOptions.length) : suggestionType === 'slash' ? slashOptions.length : suggestionType === 'shell' ? 1 : 0;

  useEffect(() => { setHighlighted(0); }, [suggestionType, atQuery, draft.startsWith('/')]);

  // post-m1-phase-6 c1b: debounced server-side `@` search — apps/api_server/src/routes/agent_sessions_routes.ts:86,
  // controller.findFiles at apps/api_server/src/controllers/agent_sessions_controller.ts:2441-2454 (query/limit/type).
  useEffect(() => {
    if (sessionGatewayMode !== 'live' || suggestionType !== 'mention' || !atQuery.trim()) { setLiveMentionResults([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void gateway.domains.sessions!.findFiles(selected.id, atQuery, { limit: 20, type: 'file' })
        .then((paths) => { if (active) setLiveMentionResults(paths); })
        .catch(() => { if (active) setLiveMentionResults([]); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [sessionGatewayMode, suggestionType, atQuery, selected.id, gateway]);

  // c1b: resolves a chosen server search result into a canonical attachment via a real
  // session-scoped content fetch — never retains the transient dropdown/display token.
  const chooseLiveMention = (path: string) => {
    const match = mentionMatch(draft);
    if (match && match.index !== undefined) setDraft(`${draft.slice(0, match.index)}${draft.slice(match.index + match[0].length)}`.trimStart());
    setMentionDismissed(false);
    const filename = path.split('/').at(-1) ?? path;
    void gateway.domains.sessions!.fileContent(selected.id, path).then((content) => {
      const id = `attachment-live-mention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const attachment: ComposerAttachment = typeof content.content === 'string'
        ? { id, type: 'text', path, filename, mime: content.mimeType || 'text/plain', size: content.content.length, content: content.content }
        : { id, type: 'file', path, filename, mime: content.mimeType || 'application/octet-stream', size: 0, fileUrl: `file:${path}` };
      setLiveMentionAttachments((current) => [...current, attachment]);
      setAttachmentFeedback(`${filename} attached.`); notify(`${filename} attached`);
    }).catch(() => { setAttachmentFeedback(`Could not attach ${filename}.`); notify(`Could not attach ${filename}`); });
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
    addFixture(file); setMentionDismissed(false); requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const submit = async () => {
    if (disabledReason) { notify(disabledReason); return; }
    const value = draft.trim();
    if (sessionGatewayMode === 'live') {
      if (!value && liveFiles.length === 0 && liveMentionAttachments.length === 0) { notify('Enter a message or attach a file before sending'); textareaRef.current?.focus(); return; }
      const oversized = liveFiles.find((file) => file.size > MAX_LIVE_PARTS_BYTES);
      if (oversized) {
        const message = `Could not send: ${oversized.name} is larger than the 20 MiB limit.`;
        setAttachmentFeedback(message); notify(message); return;
      }
      const resolved = [...liveMentionAttachments, ...await Promise.all(liveFiles.map(resolveLiveAttachment))];
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
    if (suggestionType && event.key === 'Escape') { event.preventDefault(); if (suggestionType === 'mention') setMentionDismissed(true); return; }
    if (suggestionType && suggestionCount > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); setHighlighted((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + suggestionCount) % suggestionCount); return;
    }
    if (suggestionType && suggestionCount > 0 && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); useHighlightedSuggestion(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  return (
    <form className={`composer ${offline ? 'offline' : ''}`} aria-label="Message composer" onSubmit={(event) => { event.preventDefault(); void submit(); }} data-od-id="agent-composer">
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
        <textarea id="composer-input" ref={textareaRef} value={draft} onChange={(event) => { setDraft(event.target.value); setMentionDismissed(false); }} onKeyDown={handleComposerKey} placeholder="Message the agent · / command · @ file · ! shell" rows={2} aria-describedby={`composer-help${attachmentFeedback ? ' composer-attachment-feedback' : ''}`} disabled={Boolean(disabledReason)} data-testid="composer-input" />
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
      {suggestionType && <div className="composer-suggestions" role="listbox" aria-label={`${suggestionType} suggestions`} data-testid="composer-suggestions">
        {suggestionType === 'slash' && slashOptions.map((command, index) => <button role="option" aria-selected={highlighted === index} type="button" key={command} onClick={() => { setDraft(`${command} `); textareaRef.current?.focus(); }} data-testid={`command-${command.slice(1)}`}><Icon name="command" size={14} /><strong>{command}</strong><small>Fixture command</small></button>)}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && liveMentionResults.map((path, index) => <button role="option" aria-selected={highlighted === index} type="button" key={path} onClick={() => chooseLiveMention(path)} data-testid={`mention-option-live-${index}`}><Icon name="file" size={14} /><strong>{path}</strong></button>)}
        {suggestionType === 'mention' && sessionGatewayMode === 'live' && liveMentionResults.length === 0 && <div className="suggestion-empty" role="status" data-testid="mention-no-results">No matching files</div>}
        {suggestionType === 'mention' && sessionGatewayMode !== 'live' && mentionOptions.map((file, index) => <button role="option" aria-selected={highlighted === index} type="button" key={file.id} onClick={() => chooseMention(file)} data-testid={`mention-option-${file.id}`}><Icon name="file" size={14} /><strong>{file.path}</strong><small>{file.description}</small></button>)}
        {suggestionType === 'mention' && sessionGatewayMode !== 'live' && mentionOptions.length === 0 && <div className="suggestion-empty" role="status" data-testid="mention-no-results">No matching files</div>}
        {suggestionType === 'shell' && <button role="option" aria-selected="true" type="button" onClick={() => { setDraft('!git status --short'); textareaRef.current?.focus(); }} data-testid="shell-shortcut-option"><Icon name="terminal" size={14} /><strong>!git status --short</strong><small>Run through session shell</small></button>}
      </div>}
      <div className="composer-toolbar">
        <div className="composer-selects">
          <label><span className="sr-only">Agent</span><select value={selected.profileId} onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); updateSession(selected.id, { profileId: event.target.value, model: profile?.model || selected.model }); }} data-testid="composer-profile" disabled={Boolean(disabledReason)}>{profiles.filter((profile) => profile.enabled && profile.selectable).map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label>
          <label><span className="sr-only">Model</span><select value={selected.model} onChange={(event) => setPendingModel(event.target.value)} data-testid="composer-model" disabled={Boolean(disabledReason)}><option>gpt-5.6</option><option>gpt-5.6-codex</option><option>claude-sonnet-4</option></select></label>
          <label><span className="sr-only">Permission mode</span><select value={selected.permissionMode} onChange={(event) => { if (event.target.value === 'Bypass') setBypassConfirm(true); else updateSession(selected.id, { permissionMode: event.target.value }); }} data-testid="composer-permission-mode" disabled={Boolean(disabledReason)}><option>Default</option><option>Accept Edits</option><option>Plan</option><option>Bypass</option></select></label>
          <label><span className="sr-only">Reasoning budget</span><select value={selected.thinkingBudget} onChange={(event) => updateSession(selected.id, { thinkingBudget: event.target.value })} data-testid="composer-thinking" disabled={Boolean(disabledReason)}><option>Off</option><option>Low</option><option>Medium</option><option>High</option><option>X-High</option><option>Max</option></select></label>
          <button className={`toggle-button ${selected.fastMode ? 'active' : ''}`} type="button" aria-pressed={selected.fastMode} onClick={() => updateSession(selected.id, { fastMode: !selected.fastMode })} data-testid="composer-fast" disabled={Boolean(disabledReason)}><Icon name="activity" size={13} />Fast</button>
          {sessionGatewayMode === 'live'
            ? <label className="icon-button small live-file-label" aria-label="Attach files" data-testid="composer-attach"><Icon name="attach" size={15} /><input type="file" multiple className="sr-only" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length > 0) setLiveFiles((current) => [...current, ...files]); event.target.value = ''; }} disabled={Boolean(disabledReason)} data-testid="composer-live-file-input" /></label>
            : <div className="attachment-picker-anchor"><button ref={attachButtonRef} className="icon-button small" type="button" onClick={() => setPickerOpen((value) => !value)} aria-label="Attach files" aria-haspopup="menu" aria-expanded={pickerOpen} data-testid="composer-attach" disabled={Boolean(disabledReason)}><Icon name="attach" size={15} /></button>{pickerOpen && <div ref={pickerRef} className="attachment-picker menu-popover" role="menu" aria-label="Fixture files" data-testid="attachment-picker"><div className="menu-heading"><span>Attach files</span><small>Local fixture</small></div>{fileFixtures.map((file) => <button className="menu-item stacked" role="menuitem" type="button" key={file.id} onClick={() => { addFixture(file); setPickerOpen(false); requestAnimationFrame(() => attachButtonRef.current?.focus()); }} data-testid={`attachment-option-${file.id}`}><Icon name={file.outcome === 'binary' ? 'command' : 'file'} size={14} /><span><strong>{file.path}</strong><small>{file.description}</small></span></button>)}</div>}</div>}
        </div>
        <small id="composer-help">Enter to send · Shift+Enter for newline</small>
      </div>
      <FocusDialog open={Boolean(pendingModel)} onClose={() => setPendingModel(null)} title="Apply model selection" description={pendingModel ? `Use ${pendingModel} for this prompt or make it the session default.` : ''} testId="model-scope-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPendingModel(null)}>Cancel</button><button className="secondary-button" type="button" onClick={() => { if (pendingModel) updateSession(selected.id, { model: pendingModel }); setPendingModel(null); notify('Model staged for this turn only'); }} data-testid="model-this-turn">This turn only</button><button className="primary-button" type="button" onClick={() => { if (pendingModel) updateSession(selected.id, { model: pendingModel }); setPendingModel(null); notify('Session default model updated'); }} data-testid="model-session-default">Session default</button></div></FocusDialog>
      <FocusDialog open={bypassConfirm} onClose={() => setBypassConfirm(false)} title="Bypass all permissions?" description="The agent can run tools without asking. Use this only in a trusted workspace." testId="bypass-confirm-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setBypassConfirm(false)}>Cancel</button><button className="danger-button" type="button" onClick={() => { updateSession(selected.id, { permissionMode: 'Bypass' }); setBypassConfirm(false); notify('Bypass permission mode enabled'); }} data-testid="bypass-confirm">Enable Bypass</button></div></FocusDialog>
    </form>
  );
}
