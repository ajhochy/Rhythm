import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { useGateway } from '../../gateway/context';
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

export function LiveMessagesPage({ route }: { route: string }) {
  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Messages must not build its own gateway from a build-time/test-only env value.
  const gateway = useGateway().domains.messages!;
  // RESOLVED: the gateway now exposes the workspace directory as `users()`
  // (apps/web/src/gateway/messages.ts), backed by GET /users at
  // apps/api_server/src/app.ts:144. The wiring agent that hit this gap left the picker empty and
  // reported it rather than fetching /users with the test-only token — the right call, since that
  // token is unset in a packaged build.

  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => threadIdFromRoute(route));
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [threadType, setThreadType] = useState<ThreadType>('direct');
  const [threadTitle, setThreadTitle] = useState('');
  const [directory, setDirectory] = useState<LiveDirectoryUser[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<number[]>([]);
  const [createError, setCreateError] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const selectedThread = threads.find((thread) => thread.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    gateway.threads()
      .then((loaded) => { if (active) setThreads(loaded); })
      .catch((error) => { if (active) setLoadError(boundedMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    // The recipient picker needs the workspace directory. A directory failure must not blank the
    // thread list, so it is loaded independently and degrades to the existing bounded empty state.
    gateway.users()
      .then((people) => { if (active) setDirectory(people); })
      .catch(() => { if (active) setDirectory([]); });
    return () => { active = false; };
  }, [gateway]);

  // Deep-linked selection (/messages/:id) must survive independently of whether the thread list
  // happened to include it — reload re-parses the same URL and re-runs this same fetch, so the
  // selection never depends on array order or a re-minted local id.
  useEffect(() => {
    const id = threadIdFromRoute(route);
    if (id == null) return;
    let active = true;
    gateway.messages(id)
      .then((loaded) => { if (active) setMessages(loaded); })
      .catch((error) => { if (active) setLoadError(boundedMessage(error)); });
    void gateway.markRead(id).then(() => {
      if (active) setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, unreadCount: 0, isUnread: false } : thread));
    }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  const openThread = async (id: number) => {
    setSelectedId(id);
    setReplyError('');
    try {
      const loaded = await gateway.messages(id);
      setMessages(loaded);
      await gateway.markRead(id);
      setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, unreadCount: 0, isUnread: false } : thread));
    } catch (error) {
      setLoadError(boundedMessage(error));
    }
  };

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
      await openThread(created.id);
    } catch (error) {
      setCreateError(boundedMessage(error));
    }
  };

  return (
    <section className="page-shell pg-messages" aria-labelledby="messages-title" data-testid="page-messages" {...(selectedId != null ? { 'data-selected-stable-id': selectedId } : {})}>
      <header className="messages-page-header">
        <div className="messages-heading"><span className="eyebrow">Rhythm workspace</span><h1 id="messages-title">Messages</h1><p>Move handoffs forward without losing the thread.</p></div>
        <button className="primary-button" type="button" onClick={() => void openNewThread()} data-testid="messages-new-thread">New</button>
      </header>

      {loadError && <p role="alert" data-testid="messages-live-error">{loadError}</p>}

      <div className={`messages-workspace ${selectedThread ? 'has-selection' : ''}`} data-testid="messages-responsive-primary">
        <aside className="messages-thread-rail" aria-label="Conversations">
          {loading ? <p role="status" data-testid="page-state-loading">Loading conversations…</p> : threads.length === 0 ? <p data-testid="messages-no-results">No conversations yet.</p> : (
            <ul className="messages-thread-list" role="list" data-testid="messages-thread-list">
              {threads.map((thread) => (
                <li key={thread.id} className="messages-thread-item">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-selected={selectedId === thread.id}
                    onClick={() => void openThread(thread.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openThread(thread.id); } }}
                    data-testid={`messages-thread-${thread.id}`}
                  >
                    <strong>{thread.title}</strong>
                    <small>{thread.lastMessage ?? ''}</small>
                    {thread.unreadCount > 0 && <span data-testid={`messages-thread-unread-${thread.id}`}>{thread.unreadCount}</span>}
                  </div>
                  <button type="button" onClick={() => void toggleUnread(thread)} data-testid={`messages-thread-toggle-${thread.id}`}>{thread.unreadCount > 0 ? 'Mark read' : 'Mark unread'}</button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="messages-conversation" aria-label="Selected conversation">
          {!selectedThread ? <div className="messages-selection-state" data-testid="messages-empty-selection"><h2>Select a conversation</h2></div> : (
            <>
              <header className="messages-conversation-header">
                <div className="messages-conversation-heading"><span className="eyebrow" data-testid="messages-thread-type">{selectedThread.threadType === 'group' ? 'Group' : 'Direct'}</span><h2 data-testid="messages-subject">{selectedThread.title}</h2></div>
              </header>
              <div className="messages-transcript" data-testid="messages-transcript">
                {messages.length === 0 ? <p>No messages yet.</p> : messages.map((message) => (
                  <article key={message.id} data-message-row="true"><header><strong>{message.senderName}</strong></header><p>{message.body}</p></article>
                ))}
              </div>
              <div className="messages-composer">
                <label htmlFor="messages-reply-input">Reply</label>
                <textarea ref={replyRef} id="messages-reply-input" rows={2} value={reply} onChange={(event) => { setReply(event.target.value); setReplyError(''); }} data-testid="messages-reply-input" />
                <button className="primary-button messages-send" type="button" onClick={() => void sendReply()} data-testid="messages-send">Send</button>
                {replyError && <p role="alert" data-testid="messages-reply-error">{replyError}</p>}
              </div>
            </>
          )}
        </section>
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
