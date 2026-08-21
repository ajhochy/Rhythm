// Ported from apps/web/src/pages/messages/index.tsx (410 lines) + fixtures.ts. Carried over: the
// thread rail with search and unread badges, the roving-focus thread action menu
// (read/unread/rename/delete, matching the accessibility pattern already established by
// TasksScreen's TaskMenu), the conversation transcript with auto-scroll, the composer
// (Enter-to-send, Shift+Enter newline, empty-reply validation), and the new-conversation dialog's
// direct-vs-group validation (direct requires exactly one recipient; group requires a title and
// two or more). Deliberately dropped at the host-neutral boundary: the hash-based deep-link
// route, the fixture-only page-state/mutation-mode debug pickers, the "incoming message" demo
// banner (no real gateway signal backs it), and the API-receipt ledger.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { Icon } from '../components/Icon';
import { RhythmGatewayError, type MessageThreadType, type RhythmMessageThread, type RhythmWorkspaceMember } from '../domain/types';

type MessagesSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';

function timeLabel(timestamp: string) {
  const time = timestamp.slice(11, 16);
  if (!time.includes(':')) return timestamp;
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 || 12}:${time.slice(3)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function StatePanel({ state, onRetry, onNew }: { state: Exclude<MessagesSurfaceState, 'ready'>; onRetry(): void; onNew(): void }) {
  if (state === 'loading') return <section className="messages-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Workspace messages</span><h2>Loading conversations</h2><p>Gathering thread summaries and unread state.</p></section>;
  if (state === 'empty') return <section className="messages-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A quiet inbox</span><h2>No conversations</h2><p>Start a direct message or gather a group around the next handoff.</p><button className="primary-button" type="button" onClick={onNew} data-testid="messages-empty-new-thread">New conversation</button></section>;
  if (state === 'server_error') return <section className="messages-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>Messages could not be loaded</h2><p>The message service returned a temporary error. Any open draft is preserved.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="messages-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Membership required</span><h2>Messages are restricted</h2><p>Authenticated workspace membership is required to inspect conversations.</p></section>;
  return <section className="messages-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Service prerequisite</span><h2>Messages are unavailable</h2><p>Reconnect the message service before loading or changing conversations.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function ThreadActions({ thread, canWrite, onRead, onUnread, onRename, onDelete, testId }: {
  thread: RhythmMessageThread; canWrite: boolean; onRead(): void; onUnread(): void; onRename(returnTarget: HTMLElement | null): void; onDelete(): void; testId?: string;
}) {
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

  return (
    <div className="messages-thread-menu-anchor" ref={rootRef}>
      <button ref={triggerRef} className="icon-button messages-thread-actions" type="button" aria-label={`Actions for ${thread.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={testId ?? `messages-thread-actions-${thread.id}`}><Icon name="more" size={16} /></button>
      {open && (
        <div className="menu-popover messages-thread-menu" role="menu" aria-label={`Actions for ${thread.title}`} onKeyDown={moveFocus}>
          <button className="menu-item" role="menuitem" type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => { setOpen(false); thread.unreadCount > 0 ? onRead() : onUnread(); }} data-testid={`messages-thread-toggle-${thread.id}`}>{thread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}</button>
          <button className="menu-item" role="menuitem" type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => { setOpen(false); onRename(triggerRef.current); }} data-testid={`messages-thread-rename-${thread.id}`}>Rename thread</button>
          <button className="menu-item messages-delete-action" role="menuitem" type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => { setOpen(false); onDelete(); }} data-testid={`messages-thread-delete-${thread.id}`}>Delete thread</button>
        </div>
      )}
    </div>
  );
}

export function MessagesScreen() {
  const { messages: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const [surfaceState, setSurfaceState] = useState<MessagesSurfaceState>('loading');
  const [threads, setThreads] = useState<RhythmMessageThread[]>([]);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [threadType, setThreadType] = useState<MessageThreadType>('direct');
  const [threadTitle, setThreadTitle] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [mutationPending, setMutationPending] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const loadGeneration = useRef(0);
  const renameReturnTarget = useRef<HTMLElement | null>(null);
  const canWrite = host.currentUser.collaborationCapability !== 'read';

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    const generation = ++loadGeneration.current;
    setSurfaceState('loading');
    try {
      const [loadedThreads, loadedMembers] = await Promise.all([gateway.list(), gateway.members()]);
      if (generation !== loadGeneration.current) return;
      setThreads(loadedThreads);
      setMembers(loadedMembers);
      setSurfaceState(loadedThreads.length ? 'ready' : 'empty');
    } catch (error) {
      if (generation === loadGeneration.current) handleError(error);
    }
  };

  useEffect(() => { void load(); return () => { loadGeneration.current += 1; }; }, [gateway]);

  const showsWorkspace = surfaceState === 'ready';
  const selectedThread = threads.find((thread) => thread.id === selectedId) ?? null;
  const renameTarget = threads.find((thread) => thread.id === renameTargetId) ?? null;
  const deleteTarget = threads.find((thread) => thread.id === deleteTargetId) ?? null;
  const unreadTotal = threads.filter((thread) => thread.unreadCount > 0).length;
  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle ? threads.filter((thread) => thread.title.toLocaleLowerCase().includes(needle)) : threads;
  }, [search, threads]);

  useLayoutEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [selectedThread?.messages.length]);

  const openThread = async (id: string) => {
    setSelectedId(id);
    if (canWrite && threads.find((thread) => thread.id === id)?.unreadCount) {
      try {
        await gateway.markRead(id);
        setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, unreadCount: 0 } : thread)));
      } catch (error) {
        handleError(error);
      }
    }
  };

  const markRead = async (id: string) => {
    if (!canWrite) return;
    try {
      await gateway.markRead(id);
      setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, unreadCount: 0 } : thread)));
    } catch (error) {
      handleError(error);
    }
  };

  const markUnread = async (id: string) => {
    if (!canWrite) return;
    try {
      await gateway.markUnread(id);
      setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, unreadCount: Math.max(1, thread.unreadCount) } : thread)));
    } catch (error) {
      handleError(error);
    }
  };

  const openRenameThread = (thread: RhythmMessageThread, returnTarget: HTMLElement | null) => { renameReturnTarget.current = returnTarget; setRenameTargetId(thread.id); setRenameTitle(thread.title); setRenameError(''); };
  const closeRenameThread = () => { setRenameTargetId(null); setRenameTitle(''); setRenameError(''); requestAnimationFrame(() => renameReturnTarget.current?.focus()); };

  const renameThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !renameTarget) return;
    const title = renameTitle.trim();
    if (!title) { setRenameError('Enter a thread name.'); return; }
    setMutationPending(true);
    try {
      const updated = await gateway.renameThread(renameTarget.id, title);
      setThreads((current) => current.map((thread) => (thread.id === updated.id ? updated : thread)));
      closeRenameThread();
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const openDeleteThread = (thread: RhythmMessageThread) => setDeleteTargetId(thread.id);
  const closeDeleteThread = () => setDeleteTargetId(null);

  const deleteThread = async () => {
    if (!canWrite || !deleteTarget) return;
    setMutationPending(true);
    try {
      await gateway.deleteThread(deleteTarget.id);
      setThreads((current) => current.filter((thread) => thread.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        // Match the production rail: choose the immediately following *visible* row, falling
        // back to the previous visible row only at the tail. Searching therefore changes the
        // navigation set without making a hidden thread unexpectedly active.
        const visibleIndex = visibleThreads.findIndex((thread) => thread.id === deleteTarget.id);
        const adjacent = visibleIndex >= 0
          ? visibleThreads[visibleIndex + 1] ?? visibleThreads[visibleIndex - 1] ?? null
          : threads[threads.findIndex((thread) => thread.id === deleteTarget.id) + 1]
            ?? threads[threads.findIndex((thread) => thread.id === deleteTarget.id) - 1]
            ?? null;
        setSelectedId(adjacent?.id ?? null);
        setReply('');
        setReplyError('');
      }
      closeDeleteThread();
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const openNewThread = () => { setNewThreadOpen(true); setThreadType('direct'); setThreadTitle(''); setSelectedRecipients([]); };
  const closeNewThread = () => setNewThreadOpen(false);

  const toggleRecipient = (id: string) => setSelectedRecipients((current) => (threadType === 'direct' ? [id] : current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  const changeThreadType = (next: MessageThreadType) => { setThreadType(next); setSelectedRecipients((current) => (next === 'direct' ? current.slice(0, 1) : current)); };

  const canCreate = threadType === 'direct' ? selectedRecipients.length === 1 : selectedRecipients.length >= 2 && threadTitle.trim().length > 0;

  const createThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !canCreate || mutationPending) return;
    setMutationPending(true);
    try {
      const created = await gateway.createThread({ participantIds: selectedRecipients, type: threadType, title: threadTitle.trim() || undefined });
      setThreads((current) => [created, ...current]);
      setSelectedId(created.id);
      closeNewThread();
      if (surfaceState === 'empty') setSurfaceState('ready');
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const sendReply = async () => {
    if (!canWrite || !selectedThread || mutationPending) return;
    const body = reply.trim();
    if (!body) { setReplyError('Write a message before sending.'); replyRef.current?.focus(); return; }
    setMutationPending(true);
    try {
      const message = await gateway.send(selectedThread.id, body);
      setThreads((current) => current.map((thread) => (thread.id === selectedThread.id ? { ...thread, messages: [...thread.messages, message], lastMessage: body } : thread)));
      setReply('');
      setReplyError('');
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  return (
    <ScreenRoot screenName="Messages" testId="rhythm-messages-screen">
      <section className="page-shell pg-messages" aria-busy={surfaceState === 'loading'}>
        <header className="messages-page-header">
          <div className="messages-heading"><span className="eyebrow">Rhythm workspace</span><h1>Messages</h1><p>Move handoffs forward without losing the thread.</p></div>
          <button className="primary-button" type="button" disabled={!showsWorkspace || !canWrite} title={!canWrite ? 'You can inspect messages, but this host has not granted write permission.' : undefined} onClick={openNewThread} data-testid="messages-new-thread"><Icon name="plus" size={15} /><span>New</span></button>
        </header>

        {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} onNew={openNewThread} />}
        {showsWorkspace && (
          <div className={`messages-workspace ${selectedThread ? 'has-selection' : ''}`}>
            <aside className="messages-thread-rail" aria-label="Conversations">
              <div className="messages-rail-summary">
                <strong data-testid="messages-unread-total">{unreadTotal} unread {unreadTotal === 1 ? 'thread' : 'threads'}</strong>
                <span data-testid="messages-visible-count">{visibleThreads.length} {visibleThreads.length === 1 ? 'conversation' : 'conversations'}</span>
              </div>
              <label className="search-field messages-search">
                <Icon name="search" size={14} />
                <span className="sr-only">Search conversations by title</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" data-testid="messages-thread-search" />
              </label>
              <div className="messages-thread-list" role="grid" aria-label="Conversation list" data-testid="messages-thread-list">
                {visibleThreads.map((thread) => (
                  <div key={thread.id} className="messages-thread-item" role="row">
                    <div className="messages-thread-row" role="gridcell" tabIndex={0} aria-selected={selectedId === thread.id} onClick={() => void openThread(thread.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openThread(thread.id); } }} data-testid={`messages-thread-${thread.id}`}>
                      <span className="messages-thread-avatar" aria-hidden="true">{thread.participants[0]?.initials ?? 'R'}</span>
                      <span className="messages-thread-copy"><strong>{thread.title}</strong><small>{thread.lastMessage}</small></span>
                      <time dateTime={thread.updatedAt}>{timeLabel(thread.updatedAt)}</time>
                      {thread.unreadCount > 0 && <span className="messages-row-unread" aria-label={`${thread.unreadCount} unread message`} data-testid={`messages-thread-unread-${thread.id}`}>{thread.unreadCount}</span>}
                    </div>
                    <div role="gridcell"><ThreadActions thread={thread} canWrite={canWrite} onRead={() => void markRead(thread.id)} onUnread={() => void markUnread(thread.id)} onRename={(target) => openRenameThread(thread, target)} onDelete={() => openDeleteThread(thread)} /></div>
                  </div>
                ))}
              </div>
              {visibleThreads.length === 0 && <div className="messages-no-results" data-testid="messages-no-results"><h2>No matching conversations</h2><p>Try a shorter title or clear the search.</p><button className="secondary-button" type="button" onClick={() => setSearch('')} data-testid="messages-clear-search">Clear search</button></div>}
            </aside>

            <section className="messages-conversation" aria-label="Selected conversation">
              {!selectedThread ? (
                <div className="messages-selection-state" data-testid="messages-empty-selection"><h2>Select a conversation</h2><p>Choose a thread to read its participants and transcript.</p></div>
              ) : (
                <>
                  <header className="messages-conversation-header">
                    <div className="messages-conversation-heading">
                      <span className="eyebrow" data-testid="messages-thread-type">{selectedThread.type === 'group' ? 'Group' : 'Direct'}</span>
                      <h2 data-testid="messages-subject">{selectedThread.title}</h2>
                      <p><span data-testid="messages-participants">{selectedThread.participants.map((participant) => participant.name).join(' · ')}</span><span aria-hidden="true"> · </span>{selectedThread.messages.length} {selectedThread.messages.length === 1 ? 'message' : 'messages'}</p>
                    </div>
                    <ThreadActions thread={selectedThread} canWrite={canWrite} onRead={() => void markRead(selectedThread.id)} onUnread={() => void markUnread(selectedThread.id)} onRename={(target) => openRenameThread(selectedThread, target)} onDelete={() => openDeleteThread(selectedThread)} testId="messages-selected-thread-actions" />
                  </header>
                  <div className="messages-transcript" ref={transcriptRef} tabIndex={0} aria-label={`${selectedThread.title} transcript`} aria-live="polite" data-testid="messages-transcript">
                    {selectedThread.messages.length === 0 ? <div className="messages-transcript-empty"><p>No messages yet. Start the conversation below.</p></div> : selectedThread.messages.map((message) => (
                      <article className="messages-message" key={message.id}><header><strong>{message.senderName}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></header><p>{message.body}</p></article>
                    ))}
                  </div>
                  <div className="messages-composer">
                    <label htmlFor="messages-reply-input">Reply</label>
                    <div>
                      <textarea
                        ref={replyRef}
                        id="messages-reply-input"
                        rows={2}
                        value={reply}
                        disabled={!canWrite}
                        title={!canWrite ? 'This host grants inspection only.' : undefined}
                        onChange={(event) => { setReply(event.target.value); setReplyError(''); }}
                        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendReply(); } }}
                        aria-describedby={replyError ? 'messages-reply-error' : 'messages-reply-help'}
                        data-testid="messages-reply-input"
                      />
                      <button className="primary-button messages-send" type="button" disabled={mutationPending || !canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => void sendReply()} data-testid="messages-send"><Icon name="plus" size={16} /><span>Send</span></button>
                    </div>
                    <small id="messages-reply-help">Enter to send · Shift+Enter for a new line</small>
                    {replyError && <p id="messages-reply-error" role="alert" data-testid="messages-reply-error">{replyError}</p>}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        <FocusDialog open={newThreadOpen} onClose={closeNewThread} title="New conversation" description="Choose one person for a direct message or at least two other participants for a group." testId="messages-new-thread-dialog" wide>
          <form className="messages-new-thread-form" onSubmit={(event) => void createThread(event)}>
            <label className="messages-field" data-autofocus>{threadType === 'group' ? 'Group name (required)' : 'Optional title'}<input value={threadTitle} onChange={(event) => setThreadTitle(event.target.value)} data-autofocus required={threadType === 'group'} data-testid="messages-new-thread-title" /></label>
            <fieldset className="messages-type-fieldset"><legend>Conversation type</legend>
              <div className="messages-type-options">
                <label><input type="radio" name="thread-type" value="direct" checked={threadType === 'direct'} onChange={() => changeThreadType('direct')} data-testid="messages-thread-type-direct" />Direct</label>
                <label><input type="radio" name="thread-type" value="group" checked={threadType === 'group'} onChange={() => changeThreadType('group')} data-testid="messages-thread-type-group" />Group</label>
              </div>
            </fieldset>
            <fieldset className="messages-recipient-fieldset"><legend>{threadType === 'group' ? 'Select participants (2 or more)' : 'Select one participant'}</legend>
              <div className="messages-recipient-list">
                {members.map((person) => (
                  <label key={person.id}>
                    <input type="checkbox" checked={selectedRecipients.includes(person.id)} onChange={() => toggleRecipient(person.id)} data-testid={`messages-recipient-${person.id}`} />
                    <span className="messages-thread-avatar" aria-hidden="true">{person.initials}</span>
                    <strong>{person.name}</strong>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeNewThread} data-testid="messages-new-thread-cancel">Cancel</button>
              <button className="primary-button" type="submit" disabled={!canCreate || mutationPending} data-testid="messages-create-thread">Create</button>
            </div>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(renameTarget)} onClose={closeRenameThread} title="Rename thread" description="Change how this conversation appears in Messages." testId="messages-rename-thread-dialog">
          <form className="messages-thread-edit-form" onSubmit={(event) => void renameThread(event)}>
            <label className="messages-field">Thread name<input data-autofocus value={renameTitle} onChange={(event) => { setRenameTitle(event.target.value); setRenameError(''); }} aria-describedby={renameError ? 'messages-rename-thread-error' : undefined} data-testid="messages-rename-thread-input" /></label>
            {renameError && <p className="messages-form-error" id="messages-rename-thread-error" role="alert" data-testid="messages-rename-thread-error">{renameError}</p>}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeRenameThread} data-testid="messages-rename-thread-cancel">Cancel</button>
              <button className="primary-button" type="submit" disabled={mutationPending} data-testid="messages-rename-thread-save">Save name</button>
            </div>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(deleteTarget)} onClose={closeDeleteThread} title="Delete thread" description={deleteTarget ? `Delete "${deleteTarget.title}" and its message history? This cannot be undone.` : undefined} testId="messages-delete-thread-dialog">
          <div className="messages-thread-delete-confirmation">
            <p>The next conversation will stay open so you can continue working.</p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeDeleteThread} data-testid="messages-delete-thread-cancel">Cancel</button>
              <button className="danger-button" data-autofocus type="button" disabled={mutationPending} onClick={() => void deleteThread()} data-testid="messages-delete-thread-confirm">Delete thread</button>
            </div>
          </div>
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
