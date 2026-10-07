import { useCallback, useEffect, useRef, useState } from 'react';
import { openDesignShell, type OpenDesignAttachResult } from './bridge';
import './styles.css';

const UNAVAILABLE = 'OpenDesign isn’t running. Open the OpenDesign app, then select Retry.';
const MISSING_HOST = 'OpenDesign isn’t available in this version of Rhythm.';

function blockingModalOpen() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [data-native-blocking-modal="true"]'));
}

function OpenDesignHost({ onError }: { onError(message: string): void }) {
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
        const hidden = blockingModalOpen() || rect.width <= 0 || rect.height <= 0;
        const bounds = hidden ? { x: 0, y: 0, width: 0, height: 0 } : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        void openDesignShell()?.openDesignView?.setBounds(bounds).catch(() => { if (alive) onError(UNAVAILABLE); });
      });
    };
    const observer = new ResizeObserver(reportBounds);
    if (host.current) observer.observe(host.current);
    const overlays = new MutationObserver(reportBounds);
    overlays.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['aria-expanded', 'aria-modal', 'data-native-blocking-modal', 'hidden', 'open'] });
    window.addEventListener('scroll', reportBounds, true);
    window.addEventListener('resize', reportBounds);
    const attach = async () => {
      const bridge = openDesignShell()?.openDesignView;
      if (!bridge) { onError(MISSING_HOST); return; }
      try {
        const status = await bridge.getStatus();
        if (!alive) return;
        if (status?.state !== 'ready') { onError(UNAVAILABLE); return; }
        const result = (await bridge.attach()) as OpenDesignAttachResult | undefined;
        if (!alive) return;
        // A missing or malformed response is a failure, never a blank success.
        // The attachment nonce stays private to preload; the renderer only sees `ok`.
        if (!result || result.ok !== true) { onError(UNAVAILABLE); return; }
        attached = true;
        setOpening(false);
        reportBounds();
      } catch { if (alive) onError(UNAVAILABLE); }
    };
    void attach();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      overlays.disconnect();
      window.removeEventListener('scroll', reportBounds, true);
      window.removeEventListener('resize', reportBounds);
      // Leaving the tab only suspends; the native view stays alive for return.
      if (attached) void openDesignShell()?.openDesignView?.detach().catch(() => undefined);
    };
  }, [onError]);
  return <div ref={host} className="open-design-host" data-open-design-host role="region" aria-label="OpenDesign workspace" aria-busy={opening || undefined} tabIndex={0}>
    {opening ? <p className="open-design-opening" role="status">Opening OpenDesign…</p> : null}
  </div>;
}

export function OpenDesignPage() {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const reportError = useCallback((message: string) => setError(message), []);
  if (error) return <section className="open-design-page" aria-label="OpenDesign" data-testid="page-open-design"><div className="open-design-state" tabIndex={0}><h2>OpenDesign is unavailable</h2><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Retry</button></div></section>;
  return <section className="open-design-page" aria-label="OpenDesign" data-testid="page-open-design"><OpenDesignHost key={attempt} onError={reportError} /></section>;
}
