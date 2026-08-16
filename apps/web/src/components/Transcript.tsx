import { useState } from 'react';
import { Icon } from '../icons';
import { useFixtures } from '../store';
import type { TranscriptBlock } from '../types';

function MarkdownText({ content }: { content: string }) {
  const pieces = content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <div className="markdown-copy">{pieces.map((piece, index) => piece.startsWith('**') ? <strong key={index}>{piece.slice(2, -2)}</strong> : piece.startsWith('`') ? <code key={index}>{piece.slice(1, -1)}</code> : <span key={index}>{piece}</span>)}</div>;
}

function RichBlock({ block, onOpenChild }: { block: TranscriptBlock; onOpenChild(id: string, title: string): void }) {
  if (block.kind === 'markdown') return <MarkdownText content={block.content} />;
  if (block.kind === 'reasoning') return <details className="reasoning-block"><summary><Icon name="spark" size={14} />{block.title}<span>{block.meta}</span></summary><p>{block.content}</p></details>;
  if (block.kind === 'tool') return <details className="tool-block"><summary><span className="tool-state" /> <code>{block.title}</code><span className="block-content-inline">{block.content}</span><small>{block.meta}</small></summary><pre>{`read ${block.content}\nfixture source loaded successfully`}</pre></details>;
  if (block.kind === 'diff') return <details className="tool-block" open><summary><Icon name="diff" size={14} /><strong>{block.title}</strong><small>{block.meta}</small></summary><pre className="diff-code">{block.content}</pre></details>;
  if (block.kind === 'terminal') return <details className="tool-block"><summary><Icon name="terminal" size={14} /><strong>{block.title}</strong><small>{block.meta}</small></summary><pre>{block.content}</pre></details>;
  if (block.kind === 'todos') return <div className="inline-plan"><div><Icon name="todo" size={14} /><strong>{block.title}</strong><small>{block.meta}</small></div>{block.content.split('\n').map((item, index) => <span key={item}><i className={index < 3 ? 'done' : ''}>{index < 3 && <Icon name="check" size={11} />}</i>{item}</span>)}</div>;
  // c2j: opens by the block's own SDK child id — never the local session id. See mapPart
  // in gateway/sessions.ts, which extracts this id from a `task` tool part's output text.
  if (block.kind === 'children') return <button className="child-chip" type="button" onClick={() => block.childSessionId && onOpenChild(block.childSessionId, block.content)} aria-label={`Open child session ${block.content}`} data-testid={block.childSessionId ? `open-child-${block.childSessionId}` : undefined}><span className="status-dot working" /><span><strong>{block.content}</strong><small>{block.meta}</small></span><Icon name="chevronRight" size={14} /></button>;
  // c2d: canonical `file`, `step-start`, `step-finish`, `compaction`, and `agent` parts each
  // keep their own type instead of collapsing into a markdown block.
  if (block.kind === 'file') return <div className="file-block" data-testid={`file-${block.id}`}><Icon name="file" size={14} /><strong>{block.title}</strong>{block.meta && <small>{block.meta}</small>}</div>;
  if (block.kind === 'step-start') return <div className="step-divider" role="separator" aria-label="Step started"><span>Step started</span></div>;
  if (block.kind === 'step-finish') return <div className="step-divider" role="separator" aria-label="Step finished"><span>Step finished{block.meta ? ` · ${block.meta}` : ''}</span></div>;
  if (block.kind === 'compaction') return <div className="compaction-divider"><span>{block.content}</span></div>;
  if (block.kind === 'agent') return <div className="agent-block"><Icon name="agents" size={14} /><strong>{block.title}</strong><span>{block.content}</span></div>;
  return <div className="cost-line"><Icon name="activity" size={13} /><span>{block.content}</span><small>{block.meta}</small></div>;
}

function PermissionCard() {
  const { selected, replyPermission } = useFixtures();
  const [reason, setReason] = useState('');
  const permission = selected.permission;
  if (!permission || permission.status !== 'pending') return null;
  return (
    <section className="decision-card permission-card" aria-labelledby="permission-title" data-testid="permission-card">
      <div className="decision-icon"><Icon name="command" /></div>
      <div className="decision-main"><h3 id="permission-title">Permission required</h3><p>The agent wants to <strong>{permission.operation.toLowerCase()}</strong> in this worktree.</p><pre>{permission.command}</pre><small>{permission.cwd}</small>
        <label className="field compact-field">Optional denial reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain what should change" data-testid="permission-reason" /></label>
        <div className="decision-actions"><button className="primary-button" type="button" onClick={() => replyPermission('once')} data-testid="permission-allow-once">Allow once</button><button className="secondary-button" type="button" onClick={() => replyPermission('always')} data-testid="permission-always">Always allow</button><button className="text-danger-button" type="button" onClick={() => replyPermission('reject', reason)} data-testid="permission-deny">Deny</button></div>
      </div>
    </section>
  );
}

function QuestionCard() {
  const { selected, answerQuestion, rejectQuestion } = useFixtures();
  const [answer, setAnswer] = useState('');
  const question = selected.question;
  if (!question || question.status !== 'pending') return null;
  return (
    <form className="decision-card question-card" aria-labelledby="question-title" onSubmit={(event) => { event.preventDefault(); if (answer) answerQuestion(answer); }} data-testid="question-card">
      <div className="decision-icon"><Icon name="spark" /></div>
      <div className="decision-main"><h3 id="question-title">Agent needs a decision</h3><p>{question.prompt}</p>
        <fieldset><legend className="sr-only">Answer options</legend>{question.options.map((option) => <label className="radio-row" key={option}><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} />{option}</label>)}<div className="radio-row custom-answer"><input type="radio" name="answer" aria-label="Use a custom answer" checked={Boolean(answer) && !question.options.includes(answer)} onChange={() => setAnswer('')} /><label className="sr-only" htmlFor="question-custom-answer">Custom answer</label><input id="question-custom-answer" value={!question.options.includes(answer) ? answer : ''} onChange={(event) => setAnswer(event.target.value)} placeholder="Custom response" data-testid="question-custom" /></div></fieldset>
        <div className="decision-actions"><button className="primary-button" type="submit" disabled={!answer} data-testid="question-answer">Send answer</button><button className="secondary-button" type="button" onClick={rejectQuestion} data-testid="question-reject">Reject request</button></div>
      </div>
    </form>
  );
}

export function Transcript() {
  const { selected, sessions, selectSession, demo, loading, notify, loadOlder, revertSession, unrevertSession, forkSession, summarizeSession, sendInput, sessionGatewayMode, liveChildView, openLiveChildSession } = useFixtures();
  const openChild = (id: string, title: string) => {
    if (sessionGatewayMode === 'live') { void openLiveChildSession(id, title); return; }
    const child = sessions.find((session) => session.id === id && session.parentId === selected.id);
    if (!child) { notify('Child session is unavailable in this fixture'); return; }
    selectSession(child.id); notify(`Loaded child transcript through GET /agent-sessions/${selected.id}/children/${child.id}/messages`);
  };
  // c2j: the child transcript is rendered read-only from its own fetched messages —
  // it is never selected into `sessions`, so the child's SDK id never becomes a local id.
  if (liveChildView) return (
    <section className="transcript" aria-label={`${liveChildView.title} · child transcript`} data-testid="transcript">
      {liveChildView.messages.map((message) => <article className={`message ${message.role}`} key={message.id} data-testid={`message-${message.id}`}>
        <header><span className="message-role">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Rhythm agent' : 'Session'}</span></header>
        <div className="message-blocks">{message.blocks.map((block) => <RichBlock block={block} onOpenChild={() => undefined} key={block.id} />)}</div>
      </article>)}
    </section>
  );
  if (loading) return <section className="state-panel" aria-busy="true" data-testid="loading-state"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton tall" /><p>Loading the session…</p></section>;
  if (demo === 'connecting' || demo === 'retrying') return <section className="state-panel" aria-busy="true" data-testid={`${demo}-state`}><Icon name="refresh" className="spin" size={26} /><h2>{demo === 'connecting' ? 'Connecting to desktop' : 'Retrying connection'}</h2><p>{demo === 'connecting' ? 'Rhythm is establishing the direct paired connection.' : 'The last connection attempt failed. Existing transcript content is still available.'}</p><button className="secondary-button" type="button" onClick={() => location.hash = '#/agents?demo=running'}>Return to working session</button></section>;
  if (demo === 'error') return <section className="state-panel" data-testid="error-state"><Icon name="background" size={26} /><h2>Session service unavailable</h2><p>The session list could not be loaded. Existing transcript content remains unchanged.</p><button className="primary-button" type="button" onClick={() => location.hash = '#/agents?demo=running'}>Retry</button></section>;
  if (demo === 'no-provider') return <section className="state-panel" data-testid="no-provider-state"><Icon name="profile" size={26} /><h2>Choose a model to begin</h2><p>This session has no available agent model. Open Profiles to choose a provider and model.</p><button className="primary-button" type="button" onClick={() => location.hash = '#/profiles'}>Open Profiles</button></section>;
  if (demo === 'resumable') return <section className="state-panel" data-testid="resumable-state"><Icon name="background" size={26} /><h2>Agent runtime unavailable</h2><p>The transcript and artifacts remain readable. Resume when the desktop runtime is available.</p><button className="primary-button" type="button" onClick={() => location.hash = '#/agents?demo=running'}>Resume fixture session</button></section>;
  if (demo === 'empty' || selected.messages.length === 0) return <section className="state-panel" data-testid="empty-state"><Icon name="agents" size={28} /><h2>{demo === 'empty' ? 'No sessions in this view' : 'Start this conversation'}</h2><p>{demo === 'empty' ? 'Adjust filters or start a new chat.' : 'Choose a starter or write a precise request below.'}</p><div className="starter-row"><button type="button" onClick={() => sendInput('Review the project context and propose the next safe step.')}>Review project context</button><button type="button" onClick={() => sendInput('Summarize current changes and unresolved decisions.')}>Summarize changes</button></div></section>;
  return (
    <section className="transcript" aria-label={`${selected.name} transcript`} data-testid="transcript">
      {(sessionGatewayMode !== 'live' || selected.transcriptHasMore !== false) && <div className="load-older-wrap"><button className="text-button" type="button" onClick={() => loadOlder(selected.id)} data-testid="load-older"><Icon name="history" size={14} />Load older messages</button></div>}
      {selected.retry && <div className="retry-banner" role="status" data-testid="retry-status"><Icon name="refresh" className="spin" size={13} /><span>Retrying · attempt {selected.retry.attempt} · {selected.retry.reason}</span></div>}
      {(selected.permission?.status === 'pending' || selected.question?.status === 'pending') && <div className="pending-trigger-banner" role="status"><span className="status-dot waiting" />Agent paused · {selected.permission?.status === 'pending' ? 'permission required before the tool can continue' : 'answer required before the plan can continue'}</div>}
      {selected.revertedMessageId && <div className="reverted-banner" role="status" data-testid="reverted-banner"><Icon name="undo" /><span>History after this point is reverted. You can restore it without losing the fixture transcript.</span><button className="secondary-button" type="button" onClick={() => unrevertSession(selected.id)} data-testid="unrevert">Restore history</button></div>}
      {selected.messages.map((message) => <article className={`message ${message.role}`} key={message.id} data-testid={`message-${message.id}`}>
        <header><span className="message-role">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Rhythm agent' : 'Session'}</span><time dateTime={message.createdAt}>Aug 12 · {message.createdAt.slice(11, 16)}</time></header>
        <div className="message-blocks">{message.blocks.map((block) => <RichBlock block={block} onOpenChild={openChild} key={block.id} />)}</div>
        {message.attachments && message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <span key={attachment.id}><Icon name={attachment.type === 'file' ? 'command' : 'file'} size={13} />{attachment.filename}{attachment.truncated ? ' · first 100 KB' : ''}</span>)}</div>}
        {message.id === 'msg-user-handoff' && <div className="message-attachments"><span><Icon name="file" size={13} />run-sheet.md</span><span><Icon name="command" size={13} />/review</span></div>}
        {message.id === 'msg-assistant-handoff' && <div className="compaction-divider"><span>Context compacted · 8,420 tokens retained</span></div>}
        <footer className="message-actions"><button type="button" onClick={() => notify('Message copied to clipboard')} data-testid={`copy-${message.id}`}><Icon name="copy" size={13} />Copy</button>{message.role === 'assistant' && !selected.parentId && <><button type="button" onClick={() => revertSession(selected.id, message.id)} data-testid={`revert-${message.id}`}><Icon name="undo" size={13} />Revert</button><button type="button" onClick={() => forkSession(selected.id)} data-testid={`fork-${message.id}`}><Icon name="fork" size={13} />Fork</button><button type="button" onClick={() => summarizeSession(selected.id)} data-testid={`summarize-${message.id}`}><Icon name="spark" size={13} />Compact</button></>}</footer>
      </article>)}
      {selected.queuedDraft && <article className="message user queued-message" aria-label="Queued local draft"><header><span className="message-role">You · queued locally</span><time>Not sent</time></header><p>{selected.queuedDraft}</p><small>Waiting for the direct desktop connection. Rhythm has not told the server this message exists.</small></article>}
      <PermissionCard />
      <QuestionCard />
    </section>
  );
}
