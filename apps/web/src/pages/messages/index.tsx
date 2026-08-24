import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { navigate } from '../../components/Shell';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { LiveMessagesPage } from './live';
import {
  cloneSeededMessageThreads,
  currentMessageUser,
  initialMessageReceipts,
  messageRecipients,
  type MessageParticipant,
  type MessageThreadFixture,
  type MessageThreadType,
} from './fixtures';
import './styles.css';

type MessagesSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type MutationMode = 'success' | 'server-error';

const supportedStates: MessagesSurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialSurfaceState(): MessagesSurfaceState {
  const state = hashParams().get('state');
  return supportedStates.includes(state as MessagesSurfaceState) ? state as MessagesSurfaceState : 'ready';
}

function threadIdFromRoute(route: string) {
  const value = route.slice('/messages/'.length);
  return route.startsWith('/messages/') && value ? decodeURIComponent(value.split('/')[0]) : null;
}

function timeLabel(timestamp: string) {
  const time = timestamp.slice(11, 16);
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 || 12}:${time.slice(3)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function threadIdForTitle(title: string) {
  const slug = title.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `thread-${slug || 'new-conversation'}`;
}

function StatePanel({ state, onRetry, onNew }: { state: Exclude<MessagesSurfaceState, 'ready' | 'readonly'>; onRetry(): void; onNew(): void }) {
  if (state === 'loading') return <section className="messages-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="messages-spinner" aria-hidden="true" /><span className="eyebrow">Workspace messages</span><h2>Loading conversations</h2><p>Gathering thread summaries and unread state.</p></section>;
  if (state === 'empty') return <section className="messages-state" role="status" data-testid="page-state-empty"><span className="messages-state-mark" aria-hidden="true">＋</span><span className="eyebrow">A quiet inbox</span><h2>No conversations</h2><p>Start a direct message or gather a group around the next handoff.</p><button className="primary-button" type="button" onClick={onNew} data-testid="messages-empty-new-thread">New conversation</button></section>;
  if (state === 'server-error') return <section className="messages-state danger" role="alert" data-testid="page-state-server-error"><span className="messages-state-code">503</span><span className="eyebrow">Retryable server error</span><h2>Messages could not be loaded</h2><p>The seeded adapter returned an error. Any open dialog and draft are preserved for recovery.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="messages-state warning" role="alert" data-testid="page-state-forbidden"><span className="messages-state-code">403</span><span className="eyebrow">Membership required</span><h2>Messages are restricted</h2><p>Authenticated workspace membership is required to inspect conversations.</p></section>;
  return <section className="messages-state warning" role="status" data-testid="page-state-unavailable"><span className="messages-state-mark" aria-hidden="true">◇</span><span className="eyebrow">Desktop prerequisite</span><h2>Messages are unavailable</h2><p>Reconnect the local Rhythm API before loading or changing conversations.</p></section>;
}

function ThreadActions({ thread, readonly, onRead, onUnread, onRename, onDelete, testId }: { thread: MessageThreadFixture; readonly: boolean; onRead(): void; onUnread(): void; onRename(): void; onDelete(): void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (!items.length) return;
    event.preventDefault();
    const index = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <div className="messages-thread-menu-anchor" ref={rootRef}>
    <button ref={triggerRef} className="icon-button messages-thread-actions" type="button" aria-label={`Actions for ${thread.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={testId ?? `messages-thread-actions-${thread.id}`}><Icon name="more" size={16} /></button>
    {open && <div className="menu-popover messages-thread-menu" role="menu" aria-label={`Actions for ${thread.title}`} onKeyDown={moveFocus}>
      <button className="menu-item" role="menuitem" type="button" disabled={readonly} aria-describedby={readonly ? 'messages-readonly-reason' : undefined} onClick={() => { setOpen(false); thread.unreadCount > 0 ? onRead() : onUnread(); }} data-testid={`messages-thread-toggle-${thread.id}`}>{thread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}</button>
      <button className="menu-item" role="menuitem" type="button" disabled={readonly} aria-describedby={readonly ? 'messages-readonly-reason' : undefined} onClick={() => { setOpen(false); onRename(); }} data-testid={`messages-thread-rename-${thread.id}`}>Rename thread</button>
      <button className="menu-item messages-delete-action" role="menuitem" type="button" disabled={readonly} aria-describedby={readonly ? 'messages-readonly-reason' : undefined} onClick={() => { setOpen(false); onDelete(); }} data-testid={`messages-thread-delete-${thread.id}`}>Delete thread</button>
    </div>}
  </div>;
}

export function MessagesPage({ route }: { route: string }) {
  const gateway = useGateway();
  if (gateway.mode === 'live') return <LiveMessagesPage route={route} />;
  return <FixtureMessagesPage route={route} />;
}

function FixtureMessagesPage({ route }: { route: string }) {
  const { notify, setUnreadThreads } = useFixtures();
  const [surfaceState, setSurfaceState] = useState<MessagesSurfaceState>(initialSurfaceState);
  const [threads, setThreads] = useState<MessageThreadFixture[]>(cloneSeededMessageThreads);
  const [selectedId, setSelectedId] = useState<string | null>(() => threadIdFromRoute(route));
  const [search, setSearch] = useState('');
  const [receipts, setReceipts] = useState<string[]>(() => surfaceState === 'server-error' ? ['GET /message-threads → 503'] : [...initialMessageReceipts]);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [threadType, setThreadType] = useState<MessageThreadType>('direct');
  const [threadTitle, setThreadTitle] = useState('');
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [createError, setCreateError] = useState('');
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [incomingVisible, setIncomingVisible] = useState(true);
  const [mutationMode, setMutationMode] = useState<MutationMode>('success');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const hydratedRouteRef = useRef<string | null>(null);

  const selectedThread = threads.find((thread) => thread.id === selectedId) ?? null;
  const renameTarget = threads.find((thread) => thread.id === renameTargetId) ?? null;
  const deleteTarget = threads.find((thread) => thread.id === deleteTargetId) ?? null;
  const requestedThreadId = threadIdFromRoute(route);
  const invalidThread = Boolean(requestedThreadId && !selectedThread);
  const readonly = surfaceState === 'readonly';
  const unreadTotal = threads.filter((thread) => thread.unreadCount > 0).length;
  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle ? threads.filter((thread) => thread.title.toLocaleLowerCase().includes(needle)) : threads;
  }, [search, threads]);

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);
  const updateSurfaceUrl = (next: MessagesSurfaceState) => {
    const params = hashParams();
    params.set('state', next);
    history.replaceState(null, '', `#${route}?${params.toString()}`);
  };
  const changeSurfaceState = (next: MessagesSurfaceState) => { setSurfaceState(next); updateSurfaceUrl(next); };

  useEffect(() => { setUnreadThreads(unreadTotal); }, [setUnreadThreads, unreadTotal]);

  const markRead = (id: string, includeReceipt = true) => {
    setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, unreadCount: 0 } : thread));
    if (includeReceipt) { appendReceipt(`POST /message-threads/${id}/read → 204`); appendReceipt('GET /message-threads → 200'); }
    notify('Conversation marked as read');
  };

  const markUnread = (id: string) => {
    setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, unreadCount: 1 } : thread));
    appendReceipt(`POST /message-threads/${id}/unread → 204`);
    appendReceipt('GET /message-threads → 200');
    notify('Conversation marked as unread');
  };

  const hydrateThread = (id: string, shouldNavigate: boolean) => {
    if (!threads.some((thread) => thread.id === id)) return;
    if (shouldNavigate) hydratedRouteRef.current = id;
    setSelectedId(id);
    setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, unreadCount: 0 } : thread));
    appendReceipt(`POST /message-threads/${id}/read → 204`);
    appendReceipt(`GET /message-threads/${id}/messages → 200`);
    appendReceipt('GET /message-threads → 200');
    if (shouldNavigate) navigate(`/messages/${encodeURIComponent(id)}`);
  };

  useEffect(() => {
    const nextId = threadIdFromRoute(route);
    setSelectedId(nextId);
    if (nextId && threads.some((thread) => thread.id === nextId) && hydratedRouteRef.current !== nextId) {
      hydratedRouteRef.current = nextId;
      hydrateThread(nextId, false);
    }
  }, [route]);

  useLayoutEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [selectedThread?.messages.length]);

  const openRenameThread = (thread: MessageThreadFixture) => {
    setRenameTargetId(thread.id);
    setRenameTitle(thread.title);
    setRenameError('');
  };

  const closeRenameThread = () => {
    setRenameTargetId(null);
    setRenameTitle('');
    setRenameError('');
  };

  const renameThread = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    const title = renameTitle.trim();
    if (!title) {
      setRenameError('Enter a thread name.');
      return;
    }
    setThreads((current) => current.map((thread) => thread.id === renameTarget.id ? { ...thread, title } : thread));
    closeRenameThread();
    notify('Thread name updated');
  };

  const openDeleteThread = (thread: MessageThreadFixture) => setDeleteTargetId(thread.id);
  const closeDeleteThread = () => setDeleteTargetId(null);

  const deleteThread = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    const targetTitle = deleteTarget.title;
    const targetIndex = threads.findIndex((thread) => thread.id === targetId);
    const remaining = threads.filter((thread) => thread.id !== targetId);
    const fallback = selectedId === targetId ? remaining[Math.min(Math.max(targetIndex, 0), remaining.length - 1)] ?? null : selectedThread;
    setThreads(remaining);
    setDeleteTargetId(null);
    if (selectedId === targetId) {
      setSelectedId(fallback?.id ?? null);
      hydratedRouteRef.current = fallback?.id ?? null;
      setReply('');
      setReplyError('');
      navigate(fallback ? `/messages/${encodeURIComponent(fallback.id)}` : '/messages');
      requestAnimationFrame(() => {
        const focusTarget = document.querySelector<HTMLElement>(fallback ? '[data-testid="messages-selected-thread-actions"]' : '[data-testid="messages-thread-search"]');
        focusTarget?.focus({ preventScroll: true });
      });
    }
    notify(`${targetTitle} deleted`);
  };

  const openNewThread = () => {
    setNewThreadOpen(true);
    setCreateError('');
    appendReceipt('GET /users → 200');
  };

  const closeNewThread = () => {
    setNewThreadOpen(false);
    setThreadType('direct');
    setThreadTitle('');
    setSelectedRecipients([]);
    setCreateError('');
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipients((current) => threadType === 'direct' ? [id] : current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
    setCreateError('');
  };

  const changeThreadType = (next: MessageThreadType) => {
    setThreadType(next);
    setSelectedRecipients((current) => next === 'direct' ? current.slice(0, 1) : current);
    setCreateError('');
  };

  const canCreate = threadType === 'direct'
    ? selectedRecipients.length === 1
    : selectedRecipients.length >= 2 && threadTitle.trim().length > 0;

  const createThread = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    if (mutationMode === 'server-error') {
      appendReceipt(`POST /message-threads {participantIds,threadType${threadTitle.trim() ? ',title' : ''}} → 500`);
      setCreateError('Conversation could not be created. Your selections are still here.');
      notify('Conversation creation failed');
      return;
    }
    const participants = selectedRecipients.map((id) => messageRecipients.find((candidate) => candidate.id === id)).filter((candidate): candidate is MessageParticipant => Boolean(candidate));
    const title = threadTitle.trim() || participants.map((participant) => participant.name).join(', ');
    const id = threadIdForTitle(title);
    const created: MessageThreadFixture = { id, title, type: threadType, participants: [...participants, currentMessageUser], messages: [], lastMessage: 'New conversation', updatedAt: '2026-08-12T15:48:00-07:00', unreadCount: 0 };
    setThreads((current) => current.some((thread) => thread.id === id) ? current : [created, ...current]);
    appendReceipt(`POST /message-threads {participantIds,threadType${threadTitle.trim() ? ',title' : ''}} → 201`);
    appendReceipt('GET /message-threads → 200');
    appendReceipt(`POST /message-threads/${id}/read → 204`);
    appendReceipt(`GET /message-threads/${id}/messages → 200`);
    appendReceipt('GET /message-threads → 200');
    setSelectedId(id);
    setNewThreadOpen(false);
    setThreadType('direct');
    setThreadTitle('');
    setSelectedRecipients([]);
    hydratedRouteRef.current = id;
    notify(`${title} created`);
    navigate(`/messages/${encodeURIComponent(id)}`);
  };

  const sendReply = () => {
    if (!selectedThread) return;
    const body = reply.trim();
    if (!body) { setReplyError('Write a message before sending.'); replyRef.current?.focus(); return; }
    if (mutationMode === 'server-error') {
      appendReceipt(`POST /message-threads/${selectedThread.id}/messages {body} → 500`);
      setReplyError('Message could not be sent. Your draft is still here.');
      replyRef.current?.focus();
      notify('Message failed to send');
      return;
    }
    const message = { id: `message-${selectedThread.id}-reply-${selectedThread.messages.length + 1}`, senderId: currentMessageUser.id, senderName: currentMessageUser.name, body, createdAt: '2026-08-12T15:48:00-07:00' };
    setThreads((current) => current.map((thread) => thread.id === selectedThread.id ? { ...thread, messages: [...thread.messages, message], lastMessage: body, updatedAt: message.createdAt } : thread));
    appendReceipt(`POST /message-threads/${selectedThread.id}/messages {body} → 201`);
    appendReceipt('GET /message-threads → 200');
    setReply('');
    setReplyError('');
    requestAnimationFrame(() => replyRef.current?.focus());
    notify('Message sent');
  };

  const recover = () => {
    setSurfaceState('ready');
    updateSurfaceUrl('ready');
    appendReceipt('GET /message-threads → 200');
    notify('Messages reconnected');
  };

  const statePanel = surfaceState !== 'ready' && surfaceState !== 'readonly'
    ? <StatePanel state={surfaceState} onRetry={recover} onNew={openNewThread} />
    : null;

  return <section className="page-shell pg-messages" aria-labelledby="messages-title" data-testid="page-messages" {...(selectedId ? { 'data-selected-stable-id': selectedId } : {})}>
    <header className="messages-page-header">
      <div className="messages-heading"><span className="eyebrow">Rhythm workspace</span><h1 id="messages-title">Messages</h1><p>Move handoffs forward without losing the thread.</p></div>
      <div className="messages-fixture-controls" aria-label="Message view controls">
        <label>Page state<select value={surfaceState} onChange={(event) => changeSurfaceState(event.target.value as MessagesSurfaceState)} data-testid="messages-state-picker">{supportedStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
        <label>Next mutation<select value={mutationMode} onChange={(event) => setMutationMode(event.target.value as MutationMode)} data-testid="messages-mutation-mode"><option value="success">Succeed</option><option value="server-error">Return 500</option></select></label>
      </div>
      <fieldset className="messages-header-mutations" disabled={readonly} aria-disabled={readonly ? 'true' : undefined} data-testid="messages-mutations">
        <legend className="sr-only">Conversation mutations</legend>
        <button className="primary-button" type="button" onClick={openNewThread} aria-describedby={readonly ? 'messages-readonly-reason' : undefined} data-testid="messages-new-thread"><Icon name="plus" size={15} />New</button>
      </fieldset>
    </header>

    {readonly && <div className="messages-readonly" id="messages-readonly-reason" role="status" data-testid="page-state-readonly"><strong>Read-only workspace.</strong> Conversations remain inspectable; workspace edit permission is required to send, rename, delete, or change unread state.</div>}

    {statePanel ?? <div className={`messages-workspace ${selectedThread ? 'has-selection' : ''}`} data-testid="messages-responsive-primary">
      <aside className="messages-thread-rail" aria-label="Conversations">
        <div className="messages-rail-summary"><div><strong data-testid="messages-unread-total">{unreadTotal} unread {unreadTotal === 1 ? 'thread' : 'threads'}</strong><span data-testid="messages-visible-count">{visibleThreads.length} {visibleThreads.length === 1 ? 'conversation' : 'conversations'}</span></div><span aria-hidden="true">{String(unreadTotal).padStart(2, '0')}</span></div>
        <label className="search-field messages-search"><Icon name="search" size={14} /><span className="sr-only">Search conversations by title</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" data-testid="messages-thread-search" /></label>
        <ul className="messages-thread-list" role="grid" aria-label="Conversation list" data-testid="messages-thread-list">
          {visibleThreads.map((thread) => <li key={thread.id} className="messages-thread-item" role="row">
            <div className="messages-thread-row" role="gridcell" tabIndex={0} aria-selected={selectedId === thread.id} data-unread={thread.unreadCount > 0 ? 'true' : 'false'} data-thread-row="true" onClick={() => hydrateThread(thread.id, true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); hydrateThread(thread.id, true); } }} data-testid={`messages-thread-${thread.id}`}>
              <span className="messages-thread-avatar" aria-hidden="true">{thread.participants[0]?.initials ?? 'R'}</span><span className="messages-thread-copy"><strong>{thread.title}</strong><small>{thread.lastMessage}</small></span><time dateTime={thread.updatedAt}>{timeLabel(thread.updatedAt)}</time>{thread.unreadCount > 0 && <span className="messages-row-unread" aria-label={`${thread.unreadCount} unread message`} data-testid={`messages-thread-unread-${thread.id}`}>{thread.unreadCount}</span>}
            </div>
            <div role="gridcell"><ThreadActions thread={thread} readonly={readonly} onRead={() => markRead(thread.id)} onUnread={() => markUnread(thread.id)} onRename={() => openRenameThread(thread)} onDelete={() => openDeleteThread(thread)} /></div>
          </li>)}
        </ul>
        {visibleThreads.length === 0 && <div className="messages-no-results" data-testid="messages-no-results"><h2>No matching conversations</h2><p>Try a shorter title or clear the search.</p><button className="secondary-button" type="button" onClick={() => setSearch('')} data-testid="messages-clear-search">Clear search</button></div>}
      </aside>

      <section className="messages-conversation" aria-label="Selected conversation">
        {invalidThread ? <div className="messages-selection-state" data-testid="messages-thread-not-found"><span className="messages-state-mark" aria-hidden="true">?</span><h2>Conversation not found</h2><p>This link does not match a conversation in the current workspace.</p><button className="secondary-button" type="button" onClick={() => navigate('/messages')} data-testid="messages-back-to-conversations">Back to conversations</button></div>
          : !selectedThread ? <div className="messages-selection-state" data-testid="messages-empty-selection"><span className="messages-state-mark" aria-hidden="true">↗</span><h2>Select a conversation</h2><p>Choose a thread to read its participants and transcript.</p></div>
            : <>
              <header className="messages-conversation-header">
                <button className="text-button messages-mobile-back" type="button" onClick={() => navigate('/messages')} data-testid="messages-mobile-back">Back to conversations</button>
                <div className="messages-conversation-heading"><span className="eyebrow" data-testid="messages-thread-type">{selectedThread.type === 'group' ? 'Group' : 'Direct'}</span><h2 data-testid="messages-subject">{selectedThread.title}</h2><p><span data-testid="messages-participants">{selectedThread.participants.map((participant) => participant.name).join(' · ')}</span><span aria-hidden="true"> · </span>{selectedThread.messages.length} {selectedThread.messages.length === 1 ? 'message' : 'messages'}</p></div>
                <ThreadActions thread={selectedThread} readonly={readonly} onRead={() => markRead(selectedThread.id)} onUnread={() => markUnread(selectedThread.id)} onRename={() => openRenameThread(selectedThread)} onDelete={() => openDeleteThread(selectedThread)} testId="messages-selected-thread-actions" />
              </header>
              {incomingVisible && selectedThread.id === 'thread-weekend-team' && <div className="messages-incoming" role="status"><span><strong>New from Morgan</strong> · Volunteer coverage is current.</span><button className="text-button" type="button" onClick={() => setIncomingVisible(false)} data-testid="messages-incoming-dismiss">Dismiss</button></div>}
              <div className="messages-transcript" ref={transcriptRef} tabIndex={0} aria-label={`${selectedThread.title} transcript`} aria-live="polite" data-testid="messages-transcript">
                {selectedThread.messages.length === 0 ? <div className="messages-transcript-empty"><p>No messages yet. Start the conversation below.</p></div> : selectedThread.messages.map((message) => <article className={`messages-message ${message.senderId === currentMessageUser.id ? 'own' : ''}`} key={message.id} data-message-row="true"><header><strong>{message.senderName}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></header><p>{message.body}</p></article>)}
              </div>
              <fieldset className="messages-composer-fieldset" disabled={readonly} aria-disabled={readonly ? 'true' : undefined}>
                <legend className="sr-only">Reply to {selectedThread.title}</legend>
                <div className="messages-composer"><label htmlFor="messages-reply-input">Reply</label><div><textarea ref={replyRef} id="messages-reply-input" rows={2} value={reply} onChange={(event) => { setReply(event.target.value); setReplyError(''); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendReply(); } }} aria-describedby={replyError ? 'messages-reply-error' : 'messages-reply-help'} data-testid="messages-reply-input" /><button className="primary-button messages-send" type="button" onClick={sendReply} data-testid="messages-send"><Icon name="send" size={16} /><span>Send</span></button></div><small id="messages-reply-help">Enter to send · Shift+Enter for a new line</small>{replyError && <p id="messages-reply-error" role="alert" data-testid="messages-reply-error">{replyError}</p>}</div>
              </fieldset>
            </>}
      </section>
    </div>}

    <aside className="messages-trace" tabIndex={0} aria-label="API receipt ledger" data-testid="page-trace"><span>Page trace</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></aside>

    <FocusDialog open={newThreadOpen} onClose={closeNewThread} title="New conversation" description="Choose one person for a direct message or at least two other participants for a group." testId="messages-new-thread-dialog" wide>
      <form className="messages-new-thread-form" onSubmit={createThread}>
        <header className="messages-new-thread-form-header">
          <button className="icon-button" type="button" onClick={closeNewThread} aria-label="Close new conversation dialog" data-testid="messages-new-thread-close"><Icon name="close" /></button>
        </header>
        {/* Lead fix: the title must be the first focusable after the header close so the
            contract's Shift+Tab-from-title expectation lands on the close button. */}
        <fieldset disabled={readonly} aria-disabled={readonly ? 'true' : undefined}>
          <legend className="sr-only">New conversation details</legend>
          <label className="messages-field">{threadType === 'group' ? 'Group name (required)' : 'Optional title'}<input data-autofocus value={threadTitle} onChange={(event) => { setThreadTitle(event.target.value); setCreateError(''); }} required={threadType === 'group'} data-testid="messages-new-thread-title" /></label>
          <fieldset className="messages-type-fieldset"><legend>Conversation type</legend><div className="messages-type-options"><label><input type="radio" name="thread-type" value="direct" checked={threadType === 'direct'} onChange={() => changeThreadType('direct')} data-testid="messages-thread-type-direct" />Direct</label><label><input type="radio" name="thread-type" value="group" checked={threadType === 'group'} onChange={() => changeThreadType('group')} data-testid="messages-thread-type-group" />Group</label></div></fieldset>
          <fieldset className="messages-recipient-fieldset"><legend>{threadType === 'group' ? 'Select participants (2 or more)' : 'Select one participant'}</legend><div className="messages-recipient-list">{messageRecipients.map((person) => <label key={person.id}><input type="checkbox" checked={selectedRecipients.includes(person.id)} onChange={() => toggleRecipient(person.id)} data-testid={`messages-recipient-${person.id}`} /><span className="messages-thread-avatar" aria-hidden="true">{person.initials}</span><span><strong>{person.name}</strong><small>{person.email}</small></span></label>)}</div></fieldset>
        </fieldset>
        {createError && <p className="messages-form-error" role="alert" data-testid="messages-create-error">{createError}</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeNewThread} data-testid="messages-new-thread-cancel">Cancel</button><button className="primary-button" type="submit" disabled={!canCreate || readonly} aria-describedby={!canCreate ? 'messages-create-prerequisite' : readonly ? 'messages-readonly-reason' : undefined} data-testid="messages-create-thread">Create</button></div>
        <p id="messages-create-prerequisite" className="messages-prerequisite">Direct messages require one person. Groups require a name and at least two other participants.</p>
      </form>
    </FocusDialog>

    <FocusDialog open={Boolean(renameTarget)} onClose={closeRenameThread} title="Rename thread" description="Change how this conversation appears in Messages." testId="messages-rename-thread-dialog">
      <form className="messages-thread-edit-form" onSubmit={renameThread}>
        <label className="messages-field">Thread name<input data-autofocus value={renameTitle} onChange={(event) => { setRenameTitle(event.target.value); setRenameError(''); }} aria-invalid={renameError ? 'true' : undefined} aria-describedby={renameError ? 'messages-rename-thread-error' : undefined} data-testid="messages-rename-thread-input" /></label>
        {renameError && <p className="messages-form-error" id="messages-rename-thread-error" role="alert">{renameError}</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeRenameThread} data-testid="messages-rename-thread-cancel">Cancel</button><button className="primary-button" type="submit" disabled={!renameTitle.trim() || renameTitle.trim() === renameTarget?.title} data-testid="messages-rename-thread-save">Save name</button></div>
      </form>
    </FocusDialog>

    <FocusDialog open={Boolean(deleteTarget)} onClose={closeDeleteThread} title="Delete thread" description={deleteTarget ? `Delete “${deleteTarget.title}” and its message history? This action cannot be undone.` : undefined} testId="messages-delete-thread-dialog">
      <div className="messages-thread-delete-confirmation">
        <p>The next conversation will stay open so you can continue working.</p>
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeDeleteThread} data-testid="messages-delete-thread-cancel">Cancel</button><button className="danger-button" data-autofocus type="button" onClick={deleteThread} data-testid="messages-delete-thread-confirm">Delete thread</button></div>
      </div>
    </FocusDialog>
  </section>;
}
