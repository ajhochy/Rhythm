import { useEffect, useRef, useState } from 'react';
import { Splitter } from '../../components/Splitter';
import { dashboardDraftContext, hermesShell, type HermesStatus } from './bridge';
import './styles.css';

const stateLabels: Record<HermesStatus['state'], string> = {
  disabled: 'Disabled', absent: 'Not installed', starting: 'Starting', ready: 'Ready', failed: 'Needs attention', stopped: 'Stopped',
};

function HermesHost({ onError }: { onError(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let attached = false;
    let frame = 0;
    const reportBounds = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = host.current?.getBoundingClientRect();
        if (!alive || !attached || !rect) return;
        void hermesShell()?.hermesView?.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {
          if (alive) onError('Hermes could not resize its view. Retry to reconnect.');
        });
      });
    };
    const observer = new ResizeObserver(reportBounds);
    if (host.current) observer.observe(host.current);
    // Ancestor scrolling also changes the viewport-relative host rectangle.
    window.addEventListener('scroll', reportBounds, true);
    window.addEventListener('resize', reportBounds);
    const attach = async () => {
      if (!hermesShell()?.hermesView) {
        onError('The Hermes view is unavailable in this version of Rhythm.');
        return;
      }
      try {
        const result = await hermesShell()?.hermesView?.attach();
        if (!alive) return;
        if (result?.ok === false) { onError('Hermes could not open its view. Retry to reconnect.'); return; }
        attached = true;
        reportBounds();
      } catch { if (alive) onError('Hermes could not open its view. Retry to reconnect.'); }
    };
    void attach();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', reportBounds, true);
      window.removeEventListener('resize', reportBounds);
      void hermesShell()?.hermesView?.detach().catch(() => undefined);
    };
  }, [onError]);
  return <div ref={host} className="hermes-host" data-hermes-host role="region" aria-label="Hermes" tabIndex={0} />;
}

export function HermesPage() {
  const enabled = hermesShell()?.hermes?.enabled === true;
  const [status, setStatus] = useState<HermesStatus>({ state: enabled ? 'starting' : 'disabled' });
  const [busy, setBusy] = useState(false);
  const [viewError, setViewError] = useState('');
  const [intentMessage, setIntentMessage] = useState('');
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [statusWidth, setStatusWidth] = useState(220);
  const [statusHeight, setStatusHeight] = useState(120);
  const revision = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const change = (event: MediaQueryListEvent) => setCompactLayout(event.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) { setStatus({ state: 'disabled' }); return () => { alive.current = false; }; }
    let current = true;
    const accept = (next: HermesStatus) => {
      if (!current) return;
      revision.current += 1;
      setStatus(next);
      setViewError('');
    };
    const unsubscribe = hermesShell()?.hermes?.onStatus(accept);
    const initialRevision = revision.current;
    void hermesShell()?.hermes?.getStatus().then((next) => {
      if (current && initialRevision === revision.current) accept(next);
    }).catch(() => {
      if (current && initialRevision === revision.current) accept({ state: 'failed', reason: 'Hermes status is unavailable. Retry to reconnect.' });
    });
    return () => { current = false; alive.current = false; unsubscribe?.(); };
  }, [enabled]);
  const state = enabled ? status.state : 'disabled';
  const runAction = async (action: 'install' | 'restart') => {
    if (busy) return;
    setBusy(true);
    setIntentMessage('');
    const initialRevision = revision.current;
    try {
      const next = await hermesShell()?.hermes?.[action]();
      if (alive.current && next && initialRevision === revision.current) { setStatus(next); setViewError(''); }
    } catch {
      if (alive.current && initialRevision === revision.current) setStatus({ state: 'failed', reason: 'Hermes could not start. Retry to reconnect.' });
    } finally { if (alive.current) setBusy(false); }
  };
  const askAboutDashboard = async () => {
    if (state !== 'ready') return;
    try {
      const result = await hermesShell()?.hermesView?.sendIntent({ v: 1, type: 'new-chat', context: dashboardDraftContext() });
      if (!alive.current) return;
      setIntentMessage(result?.ok === false
        ? result.reason === 'unsupported-draft'
          ? 'This Hermes dashboard does not support opening a draft from Rhythm yet. No message was sent.'
          : 'Hermes could not open the draft. No message was sent.'
        : 'Draft requested. Review it in Hermes before sending.');
    } catch { if (alive.current) setIntentMessage('Hermes could not open the draft. No message was sent.'); }
  };
  return <section className="hermes-page" aria-labelledby="hermes-title" data-testid="page-hermes" data-hermes-state={state}>
    <header className="hermes-toolbar">
      <div><h1 id="hermes-title">Hermes</h1><p>Your local Hermes workspace.</p></div>
      <button type="button" className="primary-button" disabled={state !== 'ready' || !!viewError || !hermesShell()?.hermesView} onClick={() => void askAboutDashboard()}>Ask Hermes about my dashboard</button>
    </header>
    {intentMessage && <p className="hermes-notice" role="status">{intentMessage}</p>}
    <div className="hermes-layout" style={{ '--hermes-status-width': `${statusWidth}px`, '--hermes-status-height': `${statusHeight}px` } as React.CSSProperties}>
      <aside className="hermes-inspector" aria-label="Hermes status" tabIndex={0}>
        <h2>Connection</h2>
        <dl><dt>Status</dt><dd aria-live="polite">{stateLabels[state]}</dd>{status.version && <><dt>Version</dt><dd>{status.version}</dd></>}</dl>
        <p>Opens on this Mac.</p>
        <p>Dashboard context is shared only when you choose the toolbar action.</p>
      </aside>
      {compactLayout
        ? <Splitter orientation="horizontal" storageKey="layout.hermes.status-height" min={80} max={220} defaultSize={120} onResize={setStatusHeight} ariaLabel="Resize Hermes status" testId="hermes-status-resizer" />
        : <Splitter orientation="vertical" storageKey="layout.hermes.status-width" min={180} max={360} defaultSize={220} onResize={setStatusWidth} ariaLabel="Resize Hermes status" testId="hermes-status-resizer" />}
      <div className="hermes-content">
        {state === 'ready' && !viewError ? <HermesHost key={`${status.url ?? ''}:${status.port ?? ''}`} onError={setViewError} /> : <div className="hermes-state" tabIndex={0}>
          {state === 'disabled' && <><h2>Hermes is disabled</h2><p>Open Rhythm for desktop to use Hermes. If it was disabled, launch Rhythm with <code>RHYTHM_HERMES_ENABLED=1</code> to enable it.</p></>}
          {state === 'absent' && <><h2>Install Hermes on this Mac</h2><p>Hermes needs a local installation before its workspace can open. Review the installation details in the desktop confirmation dialog.</p><button type="button" className="primary-button" disabled={busy} onClick={() => void runAction('install')}>{busy ? 'Opening installer…' : 'Install Hermes…'}</button></>}
          {state === 'starting' && <div role="status"><h2>Starting Hermes…</h2><p>Preparing your local workspace{status.version ? ` · ${status.version}` : ''}.</p><progress aria-label="Starting Hermes" /></div>}
          {(state === 'failed' || state === 'stopped' || viewError) && <><h2>{state === 'stopped' ? 'Hermes has stopped' : 'Hermes could not open'}</h2><p role="alert">{viewError || status.reason || 'The local Hermes service is unavailable.'}</p><button type="button" className="primary-button" disabled={busy} onClick={() => void runAction('restart')}>{busy ? 'Retrying…' : 'Retry'}</button></>}
        </div>}
      </div>
    </div>
  </section>;
}
