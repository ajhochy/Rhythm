import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { ListInspector, useSelectedId } from '../../components/ListInspector';
import { useAuthUser } from '../../gateway/auth';
import { useGateway } from '../../gateway/context';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import {
  MessagesGatewayError,
  type Message,
  type MessageThread,
} from '../../gateway/messages';
import './styles.css';

// Canonical thread type values — apps/api_server/src/models/message.ts:8.
type ThreadType = 'direct' | 'group';

interface LiveDirectoryUser { id: number; name: string; email: string }

function boundedMessage(error: unknown): string {
  // Never surface raw response bodies, bearer tokens, stack traces, or paths — the gateway's
  // own error text is already a bounded, generic label (apps/web/src/gateway/messages.ts:19).
  if (error instanceof MessagesGatewayError) return error.message;
  return 'Messages service unavailable';
}

// MessageThread.id is a persisted number (apps/api_server/src/models/message.ts:4), never a
// re-minted string key — the deep link's id segment is parsed straight to that numeric type.
function threadIdFromRoute(route: string): number | null {
  const match = route.match(/^\/messages\/([^/]+)$/);
  if (!match) return null;
  const id = Number(decodeURIComponent(match[1]));
  return Number.isFinite(id) ? id : null;
}

function timeLabel(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function LiveThreadActions({ thread, onRead, onUnread, testId }: {
  thread: MessageThread;
  onRead(): void;
  onUnread(): void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <div className="messages-thread-menu-anchor" ref={rootRef}>
    <button ref={triggerRef} className="icon-button messages-thread-actions" type="button" aria-label={`Actions for ${thread.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={testId ?? `messages-thread-actions-${thread.id}`}><Icon name="more" size={16} /></button>
    {open && <div className="menu-popover messages-thread-menu" role="menu" aria-label={`Actions for ${thread.title}`} onKeyDown={moveFocus}>
      <button className="menu-item" role="menuitem" type="button" onClick={() => { setOpen(false); thread.unreadCount > 0 ? onRead() : onUnread(); }}>{thread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}</button>
    </div>}
  </div>;
}

export function LiveMessagesPage({ route }: { route: string }) {
  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Messages must not build its own gateway from a build-time/test-only env value.
  const gateway = useGateway().domains.messages!;
  const authUser = useAuthUser();
  const {
    liveMessageThreads: threads,
    setLiveMessageThreads: setThreads,
    liveMessagesLoading: loading,
    liveMessagesError,
  } = useFixtures();
  // RESOLVED: the gateway now exposes the workspace directory as `users()`
  // (apps/web/src/gateway/messages.ts), backed by GET /users at
  // apps/api_server/src/app.ts:144. The wiring agent that hit this gap left the picker empty and
  // reported it rather than fetching /users with the test-only token — the right call, since that
  // token is unset in a packaged build.

  const [storedSelectedId, setStoredSelectedId] = useSelectedId('threadId');
  const selectedId = storedSelectedId == null ? threadIdFromRoute(route) : Number(storedSelectedId);
  const selectedKey = storedSelectedId ?? (threadIdFromRoute(route)?.toString() ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pageLoadError, setLoadError] = useState('');
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [threadType, setThreadType] = useState<ThreadType>('direct');
  const [threadTitle, setThreadTitle] = useState('');
  const [directory, setDirectory] = useState<LiveDirectoryUser[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<number[]>([]);
  const [createError, setCreateError] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  const messageRequestRef = useRef(0);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const loadError = pageLoadError || liveMessagesError;

  const selectedThread = threads.find((thread) => thread.id === selectedId) ?? null;
  const unreadTotal = threads.filter((thread) => thread.unreadCount > 0).length;

  useLayoutEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages.length, selectedId]);

  useEffect(() => {
    let active = true;
    // The recipient picker needs the workspace directory. A directory failure must not blank the
    // thread list, so it is loaded independently and degrades to the existing bounded empty state.
    gateway.users()
      .then((people) => { if (active) setDirectory(people); })
      .catch(() => { if (active) setDirectory([]); });
    return () => { active = false; };
  }, [gateway]);

  // Deep-linked and URL-query selection survives reload independently of thread list ordering.
  // Selection only loads inspector content; unread mutations remain explicit inspector actions.
  useEffect(() => {
    const id = selectedId;
    if (id == null || !Number.isFinite(id)) { setMessages([]); selectedIdRef.current = null; return; }
    selectedIdRef.current = id;
    const requestId = ++messageRequestRef.current;
    setLoadError('');
    setMessages([]);
    gateway.messages(id)
      .then((loaded) => { if (requestId === messageRequestRef.current && selectedIdRef.current === id) setMessages(loaded); })
      .catch((error) => { if (requestId === messageRequestRef.current) setLoadError(boundedMessage(error)); });
    return () => { messageRequestRef.current += 1; };
  }, [gateway, selectedId]);

  useEffect(() => {
    const refresh = () => {
      const id = selectedIdRef.current;
      if (id == null) return;
      const requestId = ++messageRequestRef.current;
      void gateway.messages(id).then((loaded) => {
        if (requestId === messageRequestRef.current && selectedIdRef.current === id) setMessages(loaded);
      }).catch((error) => { if (requestId === messageRequestRef.current) setLoadError(boundedMessage(error)); });
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [gateway]);

  const toggleUnread = async (thread: MessageThread) => {
    try {
      if (thread.unreadCount > 0) {
        await gateway.markRead(thread.id);
        setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, unreadCount: 0, isUnread: false } : item));
      } else {
        await gateway.markUnread(thread.id);
        setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, unreadCount: 1, isUnread: true } : item));
      }
    } catch (error) {
      setLoadError(boundedMessage(error));
    }
  };

  const sendReply = async () => {
    if (!selectedThread) return;
    const body = reply.trim();
    if (!body) { setReplyError('Write a message before sending.'); replyRef.current?.focus(); return; }
    try {
      const sent = await gateway.sendMessage(selectedThread.id, { body });
      setMessages((current) => [...current, sent]);
      setThreads((current) => current.map((thread) => thread.id === selectedThread.id ? { ...thread, lastMessage: sent.body, updatedAt: sent.createdAt } : thread));
      setReply('');
      setReplyError('');
    } catch (error) {
      setReplyError(boundedMessage(error));
    }
  };

  const openNewThread = () => {
    setNewThreadOpen(true);
    setCreateError('');
  };

  const closeNewThread = () => {
    setNewThreadOpen(false);
    setThreadType('direct');
    setThreadTitle('');
    setSelectedRecipients([]);
    setCreateError('');
  };

  const toggleRecipient = (id: number) => {
    setSelectedRecipients((current) => threadType === 'direct' ? [id] : current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
  };

  const canCreate = threadType === 'direct' ? selectedRecipients.length === 1 : selectedRecipients.length >= 2 && threadTitle.trim().length > 0;

  const submitNewThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    try {
      // participantIds/threadType/title — apps/api_server/src/models/message.ts:26-32
      // (createdBy is derived server-side from the auth bearer, never sent by the client:
      // apps/api_server/src/controllers/messages_controller.ts:19-38).
      const created = await gateway.createThread({ participantIds: selectedRecipients, threadType, title: threadTitle.trim() || undefined });
      setThreads((current) => [created, ...current]);
      closeNewThread();
      setStoredSelectedId(String(created.id));
    } catch (error) {
      setCreateError(boundedMessage(error));
    }
  };

  return (
    <section className="page-shell pg-messages" aria-labelledby="messages-title" data-testid="page-messages" {...(selectedId != null ? { 'data-selected-stable-id': selectedId } : {})}>
      <header className="messages-page-header">
        <div className="messages-heading"><span className="eyebrow">Rhythm workspace</span><h1 id="messages-title">Messages</h1><p>Conversations, participants, and handoffs in one focused workspace.</p></div>
      </header>

      {loadError && <p role="alert" data-testid="messages-live-error">{loadError}</p>}

      <div className="messages-workspace" data-testid="messages-responsive-primary">
        <div className="messages-list-inspector-host" data-testid="messages-thread-list">
          <ListInspector
            className="messages-list-inspector"
            label="Conversations"
            items={threads.map((thread) => ({
              id: `messages-thread-${thread.id}`,
              title: thread.title,
              subtitle: thread.lastMessage ?? 'No messages yet',
              meta: timeLabel(thread.updatedAt),
              badge: thread.unreadCount > 0 ? `${thread.unreadCount} unread` : undefined,
            }))}
            selectedId={selectedKey == null ? null : `messages-thread-${selectedKey}`}
            onSelect={(rowId) => { setReplyError(''); setStoredSelectedId(rowId.slice('messages-thread-'.length)); }}
            toolbar={<div className="messages-list-toolbar">
              <div className="messages-rail-summary"><div><strong data-testid="messages-unread-total">{unreadTotal} unread {unreadTotal === 1 ? 'thread' : 'threads'}</strong><span>{threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}</span></div><span aria-hidden="true">{String(unreadTotal).padStart(2, '0')}</span></div>
              <fieldset className="messages-header-mutations"><legend className="sr-only">Conversation actions</legend><button className="primary-button" type="button" onClick={() => void openNewThread()} data-testid="messages-new-thread"><Icon name="plus" size={15} />New conversation</button></fieldset>
            </div>}
            searchable
            searchPlaceholder="Search conversations"
            loading={loading}
            error={!loading && liveMessagesError && threads.length === 0 ? <div className="messages-state danger"><h3>Messages could not be loaded</h3><p>{liveMessagesError}</p></div> : undefined}
            emptyState={<div className="messages-state" data-testid="messages-no-results"><span className="messages-state-mark" aria-hidden="true">＋</span><h3>No conversations yet</h3><p>Start a direct message or group handoff.</p></div>}
            inspector={(item) => {
              const thread = item ? threads.find((candidate) => `messages-thread-${candidate.id}` === item.id) ?? null : null;
              if (!thread) return <div className="messages-selection-state" data-testid="messages-empty-selection"><span className="messages-state-mark" aria-hidden="true">↗</span><h3>Select a conversation</h3><p>Choose a thread to read its participants and transcript.</p></div>;
              return <div className="messages-conversation" aria-label="Selected conversation">
                <header className="messages-conversation-header">
                  <div className="messages-conversation-heading"><span className="eyebrow" data-testid="messages-thread-type">{thread.threadType === 'group' ? 'Group' : 'Direct'}</span><span className="sr-only" data-testid="messages-subject">{thread.title}</span><p>{thread.participants.map((participant) => participant.name).join(' · ')}<span aria-hidden="true"> · </span>{messages.length} {messages.length === 1 ? 'message' : 'messages'}</p></div>
                  <LiveThreadActions thread={thread} onRead={() => void toggleUnread(thread)} onUnread={() => void toggleUnread(thread)} testId="messages-selected-thread-actions" />
                </header>
                <div className="messages-transcript" ref={transcriptRef} tabIndex={0} aria-label={`${thread.title} transcript`} aria-live="polite" data-testid="messages-transcript">
                  {messages.length === 0 ? <div className="messages-transcript-empty"><p>No messages yet. Start the conversation below.</p></div> : messages.map((message) => (
                    <article className={`messages-message ${message.senderId === authUser?.user.id ? 'own' : ''}`} key={message.id} data-message-row="true"><header><strong>{message.senderName}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></header><p>{message.body}</p></article>
                  ))}
                </div>
                <fieldset className="messages-composer-fieldset"><legend className="sr-only">Reply to {thread.title}</legend><div className="messages-composer">
                  <label htmlFor="messages-reply-input">Reply</label>
                  <div><textarea ref={replyRef} id="messages-reply-input" rows={2} value={reply} onChange={(event) => { setReply(event.target.value); setReplyError(''); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendReply(); } }} aria-describedby={replyError ? 'messages-reply-error' : 'messages-reply-help'} data-testid="messages-reply-input" /><button className="primary-button messages-send" type="button" onClick={() => void sendReply()} data-testid="messages-send"><Icon name="send" size={16} /><span>Send</span></button></div>
                  <small id="messages-reply-help">Enter to send · Shift+Enter for a new line</small>{replyError && <p id="messages-reply-error" role="alert" data-testid="messages-reply-error">{replyError}</p>}
                </div></fieldset>
              </div>;
            }}
          />
        </div>
      </div>

      <FocusDialog open={newThreadOpen} onClose={closeNewThread} title="New conversation" description="Choose one person for a direct message or at least two other participants for a group." testId="messages-new-thread-dialog" wide>
        <form className="messages-new-thread-form" onSubmit={(event) => void submitNewThread(event)}>
          <label className="messages-field">{threadType === 'group' ? 'Group name (required)' : 'Optional title'}<input data-autofocus value={threadTitle} onChange={(event) => setThreadTitle(event.target.value)} required={threadType === 'group'} data-testid="messages-new-thread-title" /></label>
          <fieldset className="messages-type-fieldset">
            <legend>Conversation type</legend>
            <div className="messages-type-options">
              <label><input type="radio" name="live-thread-type" value="direct" checked={threadType === 'direct'} onChange={() => { setThreadType('direct'); setSelectedRecipients((current) => current.slice(0, 1)); }} data-testid="messages-thread-type-direct" />Direct</label>
              <label><input type="radio" name="live-thread-type" value="group" checked={threadType === 'group'} onChange={() => setThreadType('group')} data-testid="messages-thread-type-group" />Group</label>
            </div>
          </fieldset>
          <fieldset className="messages-recipient-fieldset">
            <legend>{threadType === 'group' ? 'Select participants (2 or more)' : 'Select one participant'}</legend>
            <div className="messages-recipient-list">
              {directory.length === 0 && <p>No other workspace users found.</p>}
              {directory.map((user) => (
                <label key={user.id}><input type="checkbox" checked={selectedRecipients.includes(user.id)} onChange={() => toggleRecipient(user.id)} data-testid={`messages-recipient-${user.id}`} /><span><strong>{user.name}</strong><small>{user.email}</small></span></label>
              ))}
            </div>
          </fieldset>
          {createError && <p className="messages-form-error" role="alert" data-testid="messages-create-error">{createError}</p>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeNewThread} data-testid="messages-new-thread-cancel">Cancel</button><button className="primary-button" type="submit" disabled={!canCreate} data-testid="messages-create-thread">Create</button></div>
        </form>
      </FocusDialog>
    </section>
  );
}
