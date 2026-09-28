// #1374 slice 3 — web-remote-attach-ui.
//
// Secondary-desktop continuation: list the operator's own Mac(s) over the relay, attach to one of
// its in-flight sessions, and continue it (stream, prompt, answer permission/question prompts,
// cancel) from here. Session lifecycle controls that only make sense on the machine that owns the
// worktree (new session, delete, worktree changes, profile edits, file browsing) are intentionally
// not offered — apps/web/src/gateway/remote-sessions.ts rejects them as `remote_unsupported`.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useGateway } from '../gateway/context';
import { RemoteSessionsGatewayError, type RemoteEnvironmentSummary, type RemoteSessionSummary } from '../gateway/remote-sessions';
import type { RichTranscriptMessage, SessionWireEvent } from '../gateway/sessions';
import './RemoteComputers.css';

type ConnectState = 'idle' | 'connecting' | 'connected' | 'offline' | 'revoked' | 'error';

type PendingPermission = { id: string; tool?: string; patterns?: string[] };
type PendingQuestion = { id: string; questions?: unknown[] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function RemoteComputers({ onClose }: { onClose: () => void }) {
  const gateway = useGateway();
  const remote = gateway.domains.remoteSessions;

  const [environments, setEnvironments] = useState<RemoteEnvironmentSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [connectState, setConnectState] = useState<ConnectState>('idle');
  const [sessions, setSessions] = useState<RemoteSessionSummary[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RichTranscriptMessage[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [busyNotice, setBusyNotice] = useState('');
  const [turnError, setTurnError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // The clientMessageId for the send currently in flight or last failed. Reused on a retry of the
  // exact same logical send (busy/network error leaves `draft` intact) so the server's
  // idempotency-by-messageID cannot double-send the turn; cleared on success or once the user
  // edits the draft, since that is a new logical message.
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const socketRef = useRef<{ close(): void } | null>(null);

  const environmentName = environments?.find((row) => row.id === environmentId)?.name ?? 'this Mac';

  useEffect(() => {
    if (!remote?.enabled) return;
    let active = true;
    remote.listEnvironments().then((rows) => { if (active) setEnvironments(rows); })
      .catch(() => { if (active) setLoadError('Could not reach the Remote computers list.'); });
    return () => { active = false; };
  }, [remote]);

  useEffect(() => () => { socketRef.current?.close(); void remote?.disconnect(); }, [remote]);

  if (!remote?.enabled) return null;

  const attachEnvironment = async (id: string) => {
    setEnvironmentId(id); setConnectState('connecting'); setSessions(null); setSessionId(null);
    try {
      const result = await remote.connect(id);
      if (result.state === 'connected') {
        setConnectState('connected');
        const rows = await remote.list();
        setSessions(rows);
      } else if (result.state === 'offline') setConnectState('offline');
      else setConnectState('error');
    } catch (error) {
      setConnectState(error instanceof RemoteSessionsGatewayError && error.code === 'remote_revoked' ? 'revoked' : 'error');
    }
  };

  const attachSession = async (id: string) => {
    socketRef.current?.close();
    setSessionId(id); setMessages([]); setPendingPermission(null); setPendingQuestion(null); setTurnError(''); setPendingMessageId(null);
    try {
      const page = await remote.detail(id);
      setMessages(page.messages);
    } catch (error) {
      setTurnError(error instanceof RemoteSessionsGatewayError && error.code === 'remote_revoked' ? '' : 'Could not load this session’s transcript.');
      if (error instanceof RemoteSessionsGatewayError && error.code === 'remote_revoked') setConnectState('revoked');
    }
    socketRef.current = remote.connectSession(id, (nextMessages, event) => {
      setMessages(nextMessages);
      const info = record(event);
      if (event.type === 'permission.asked') setPendingPermission({ id: str(info.permissionID) ?? '', tool: str(info.tool), patterns: Array.isArray(info.patterns) ? info.patterns as string[] : undefined });
      else if (event.type === 'permission.replied') setPendingPermission(null);
      else if (event.type === 'question.asked') setPendingQuestion({ id: str(info.requestId) ?? '', questions: Array.isArray(info.questions) ? info.questions : undefined });
      else if (event.type === 'question.resolved') setPendingQuestion(null);
    });
  };

  const reconnect = () => { if (environmentId) void attachEnvironment(environmentId); };

  const submitPrompt = async () => {
    if (!sessionId || !draft.trim() || sending) return;
    setSending(true); setBusyNotice(''); setTurnError('');
    const messageId = pendingMessageId ?? `web-${crypto.randomUUID()}`;
    try {
      await remote.prompt(sessionId, draft.trim(), messageId);
      setPendingMessageId(null);
      setDraft('');
    } catch (error) {
      // Keep the same id so a user-initiated retry of this exact send (the draft is left intact
      // below) reuses it — an ambiguous failure (request landed server-side but the response was
      // lost) must not double-send the turn.
      setPendingMessageId(messageId);
      if (error instanceof RemoteSessionsGatewayError && error.code === 'remote_busy') setBusyNotice('This session is busy on another device. Try again shortly.');
      else if (error instanceof RemoteSessionsGatewayError && error.code === 'remote_revoked') setConnectState('revoked');
      else setTurnError('The message could not be sent.');
    } finally { setSending(false); }
  };

  const cancelTurn = async () => {
    if (!sessionId) return;
    try { await remote.cancel(sessionId); }
    catch (error) { if (error instanceof RemoteSessionsGatewayError && error.code === 'remote_revoked') setConnectState('revoked'); }
  };

  const replyPermission = async (reply: 'once' | 'always' | 'reject') => {
    if (!pendingPermission?.id) return;
    try { await remote.replyPermission(pendingPermission.id, reply); setPendingPermission(null); }
    catch { setTurnError('Could not send that decision.'); }
  };

  const replyQuestion = async (answer: string) => {
    if (!pendingQuestion?.id) return;
    try { await remote.replyQuestion(pendingQuestion.id, [[answer]]); setPendingQuestion(null); }
    catch { setTurnError('Could not send that answer.'); }
  };

  return (
    <section className="remote-computers" aria-label="Remote computers">
      <header className="remote-computers-header">
        <button className="secondary-button" type="button" onClick={onClose}><Icon name="chevronRight" className="rotate-180" size={14} />Back to sessions</button>
        <h1>Remote computers</h1>
      </header>
      <div className="remote-computers-body">
        <nav className="remote-environment-list" aria-label="Remote computers list">
          {environments === null && !loadError && <p role="status">Looking for your computers…</p>}
          {loadError && <p role="alert">{loadError}</p>}
          {environments?.length === 0 && <p>No other computer is registered for remote attach yet.</p>}
          <ul>
            {environments?.map((row) => (
              <li key={row.id}>
                <button type="button" className={row.id === environmentId ? 'selected' : ''} onClick={() => void attachEnvironment(row.id)} data-testid={`remote-environment-${row.id}`}>
                  <Icon name={row.status === 'online' ? 'check' : 'close'} size={14} />
                  <span>{row.name}</span>
                  <em>{row.status === 'online' ? 'Online' : 'Offline'}</em>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="remote-session-panel">
          {connectState === 'connecting' && <p role="status">Connecting to {environmentName}…</p>}
          {connectState === 'offline' && (
            <div className="remote-state-banner" role="alert">
              <p>{environmentName} is offline. Remote sessions need it powered on and connected.</p>
              <button className="secondary-button" type="button" onClick={reconnect}>Retry</button>
            </div>
          )}
          {connectState === 'revoked' && (
            <div className="remote-state-banner" role="alert">
              <p>Remote access to {environmentName} was revoked.</p>
              <button className="secondary-button" type="button" onClick={reconnect}>Reconnect</button>
            </div>
          )}
          {connectState === 'error' && (
            <div className="remote-state-banner" role="alert">
              <p>Could not connect to {environmentName}.</p>
              <button className="secondary-button" type="button" onClick={reconnect}>Retry</button>
            </div>
          )}
          {connectState === 'connected' && !sessionId && (
            <ul className="remote-session-list" aria-label={`Sessions on ${environmentName}`}>
              {sessions?.length === 0 && <li>No sessions are running on {environmentName} right now.</li>}
              {sessions?.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => void attachSession(row.id)} data-testid={`remote-session-${row.id}`}>
                    <strong>{str(row.title) ?? str(row.directory) ?? row.id}</strong>
                    <span>Running on {environmentName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sessionId && (
            <div className="remote-transcript" aria-label={`Remote session running on ${environmentName}`}>
              <p className="remote-unsupported-note">New session, delete, and worktree changes aren’t available for a remote session — manage those from {environmentName} itself.</p>
              <ol className="remote-message-list" aria-label="Transcript">
                {messages.map((message) => (
                  <li key={message.id} className={`remote-message ${message.role}`}>
                    <strong>{message.role}</strong>
                    {message.blocks.map((block) => <p key={block.id}>{block.content}</p>)}
                  </li>
                ))}
              </ol>
              {pendingPermission && (
                <div className="remote-decision" role="group" aria-label="Permission requested">
                  <p>Allow {pendingPermission.tool ?? 'this tool'}?</p>
                  <button type="button" onClick={() => void replyPermission('once')}>Allow once</button>
                  <button type="button" onClick={() => void replyPermission('always')}>Always allow</button>
                  <button type="button" onClick={() => void replyPermission('reject')}>Reject</button>
                </div>
              )}
              {pendingQuestion && (
                <div className="remote-decision" role="group" aria-label="Question asked">
                  <p>The agent is asking a question.</p>
                  <button type="button" onClick={() => void replyQuestion('yes')}>Yes</button>
                  <button type="button" onClick={() => void replyQuestion('no')}>No</button>
                </div>
              )}
              {busyNotice && <p role="alert">{busyNotice}</p>}
              {turnError && <p role="alert">{turnError}</p>}
              <form className="remote-composer" onSubmit={(event) => { event.preventDefault(); void submitPrompt(); }}>
                <label htmlFor="remote-composer-input">Message</label>
                <textarea id="remote-composer-input" value={draft} onChange={(event) => { setDraft(event.target.value); setPendingMessageId(null); }} disabled={sending} />
                <div className="remote-composer-actions">
                  <button type="submit" className="primary-button" disabled={sending || !draft.trim()}>Send</button>
                  <button type="button" className="secondary-button" onClick={() => void cancelTurn()}>Cancel</button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
