import { useCallback, useEffect, useRef, useState } from 'react';
import { hermesShell } from './bridge';
import './styles.css';

function HermesHost({ onError, onAttached }: { onError(message: string): void; onAttached(fallbackReason: string | undefined): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(true);
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
          if (alive) onError('Hermes Desktop could not resize. Return to the Hermes tab to retry.');
        });
      });
    };
    const observer = new ResizeObserver(reportBounds);
    if (host.current) observer.observe(host.current);
    window.addEventListener('scroll', reportBounds, true);
    window.addEventListener('resize', reportBounds);
    const attach = async () => {
      if (!hermesShell()?.hermesView) {
        onError('This version of Rhythm does not include the Hermes Desktop host. Rebuild the Rhythm package.');
        return;
      }
      try {
        const result = await hermesShell()?.hermesView?.attach();
        if (!alive) return;
        if (result?.ok === false) { onError(result.reason || 'Hermes Desktop could not open. Rebuild the pinned artifact and retry.'); return; }
        attached = true;
        onAttached(result?.fallbackReason);
        setOpening(false);
        reportBounds();
      } catch { if (alive) onError('Hermes Desktop could not open. Rebuild the pinned artifact and retry.'); }
    };
    void attach();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', reportBounds, true);
      window.removeEventListener('resize', reportBounds);
      // The child remains mounted across hash-only tab changes so desktop
      // drafts and streams survive until the document is revoked or Rhythm exits.
      if (attached) void hermesShell()?.hermesView?.setBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
    };
  }, [onError, onAttached]);
  return <div
    ref={host}
    className="hermes-host"
    data-hermes-host
    role="region"
    aria-label="Hermes Desktop workspace"
    aria-busy={opening || undefined}
    tabIndex={0}
  >
    {opening ? <p className="hermes-opening" role="status">Opening Hermes Desktop…</p> : null}
  </div>;
}

// issue-1570-e: install-from-local-file only (no network update feed — see #1570). The IPC handler
// owns the native file dialog entirely; this button never supplies a path, only triggers it.
function InstallUpdateButton() {
  const [status, setStatus] = useState('');
  const [installing, setInstalling] = useState(false);
  const install = useCallback(async () => {
    setStatus('');
    setInstalling(true);
    try {
      const result = await hermesShell()?.hermesView?.installUpdate();
      if (!result || result.cancelled) return;
      setStatus(result.ok
        ? (result.version ? `Hermes ${result.version} installed. It will be used next time Hermes opens.` : 'Hermes update installed.')
        : (result.reason || 'Hermes update could not be installed.'));
    } catch {
      setStatus('Hermes update could not be installed.');
    } finally {
      setInstalling(false);
    }
  }, []);
  return <div className="hermes-update">
    <button type="button" className="secondary-button" disabled={installing} onClick={() => void install()}>
      {installing ? 'Installing…' : 'Install Hermes update…'}
    </button>
    {status ? <p role="status">{status}</p> : null}
  </div>;
}

export function HermesPage() {
  const [viewError, setViewError] = useState('');
  const [fallbackReason, setFallbackReason] = useState('');
  const handleError = useCallback((message: string) => setViewError(message), []);
  const handleAttached = useCallback((reason: string | undefined) => setFallbackReason(reason ?? ''), []);
  const disabled = hermesShell()?.hermes?.enabled === false;
  const canInstall = !disabled && Boolean(hermesShell()?.hermesView);
  return <section className="hermes-page" aria-label="Hermes" data-testid="page-hermes">
    <div className="hermes-content">
      {disabled
        ? <div className="hermes-state" tabIndex={0}><h2>Hermes is turned off in this Rhythm build</h2><p>Enable Hermes when building Rhythm to use the embedded Desktop workspace.</p></div>
        : viewError
        ? <div className="hermes-state" tabIndex={0}><h2>Hermes Desktop could not open</h2><p role="alert">{viewError}</p><button type="button" className="primary-button" onClick={() => setViewError('')}>Retry</button></div>
        : <HermesHost onError={handleError} onAttached={handleAttached} />}
    </div>
    {/* Below the workspace, not above it: keeps the pre-existing Tab order landing on
        .hermes-host first (see the RTL/keyboard-focus accessibility contract test). */}
    {canInstall && fallbackReason ? <p className="hermes-fallback-notice" role="status">{fallbackReason}</p> : null}
    {canInstall ? <InstallUpdateButton /> : null}
  </section>;
}
