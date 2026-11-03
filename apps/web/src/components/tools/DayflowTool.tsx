import { useEffect, useRef, useState } from 'react';
import { getDayflowView } from '../../gateway/dayflow-desktop';

type Phase = 'checking' | 'attached' | 'unavailable';

// Only an explicitly blocking modal hides the native view (same selector as the Hermes host).
function blockingModalOpen() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [data-native-blocking-modal="true"]'));
}

/**
 * Container for the original native Dayflow view. It measures its own rectangle and reports it to the
 * main-owned host; it never renders a timeline and never opens an external window.
 */
export function DayflowTool() {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  useEffect(() => {
    const view = getDayflowView();
    if (!view) { setPhase('unavailable'); return; }
    let alive = true;
    let attached = false;
    // `shown` means the native view MAY be visible: acknowledged unblocked, or an unblock request is in flight.
    // A freshly attached host is hidden until a positive rectangle is accepted.
    let shown = false;
    let failed = false; // once failed the view stays blocked; no later completion may reveal it
    let frame = 0;
    let seq = 0;
    const block = () => { shown = false; return view.setBlocked(true); };
    const fail = () => {
      if (!alive) return;
      failed = true;
      if (attached) void block();
      setPhase('unavailable');
    };
    // Live occlusion/layout, read fresh each time (never cached across an await).
    const occluded = () => {
      const rect = host.current?.getBoundingClientRect();
      return !rect || !(rect.width > 0) || !(rect.height > 0) || document.hidden || blockingModalOpen();
    };
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = host.current?.getBoundingClientRect();
        if (!alive || !attached || failed) return;
        const mine = ++seq;
        const superseded = () => !alive || mine !== seq;
        if (!rect || occluded()) {
          // An in-flight unblock counts as shown, so a hide is never suppressed by a stale acknowledgement.
          if (shown) void block().then((ok) => { if (!ok && alive) fail(); });
          return;
        }
        void view.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).then(async (ok) => {
          if (superseded()) return;
          if (!ok) { fail(); return; }
          if (shown) return;
          // Recheck right before reveal: layout or a modal may have changed during the bounds await.
          if (failed || occluded()) return;
          shown = true;
          const acknowledged = await view.setBlocked(false);
          if (!alive) return; // unmount already blocked and detached; never command after it
          if (!acknowledged) { fail(); return; }
          // The reveal may already be native-visible: reassert any block that became current while it was pending.
          if (failed || occluded()) void block();
        });
      });
    };
    const observer = new ResizeObserver(report);
    if (host.current) observer.observe(host.current);
    const overlays = new MutationObserver(report);
    overlays.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['aria-expanded', 'aria-modal', 'data-native-blocking-modal', 'hidden', 'open'] });
    window.addEventListener('scroll', report, true);
    window.addEventListener('resize', report);
    document.addEventListener('visibilitychange', report);
    void (async () => {
      const status = await view.getStatus();
      if (!alive) return;
      if (status.state !== 'ready') { fail(); return; }
      const result = await view.attach();
      if (!alive) return;
      if (!result.ok) { fail(); return; }
      attached = true;
      setPhase('attached');
      report();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      overlays.disconnect();
      window.removeEventListener('scroll', report, true);
      window.removeEventListener('resize', report);
      document.removeEventListener('visibilitychange', report);
      // Block first, then detach. detach also advances the facade epoch, so a still-pending attach is discarded.
      void view.setBlocked(true).catch(() => undefined);
      void view.detach().catch(() => undefined);
    };
  }, []);
  return <section className="tool-workspace dayflow-workspace" data-testid="tool-page-dayflow">
    <div className="tool-workspace-body dayflow-workspace-body">
      <div ref={host} className="dayflow-native-host" role="region" aria-label="Dayflow workspace" aria-busy={phase === 'checking' || undefined} tabIndex={0} data-testid="dayflow-native-host" data-phase={phase}>
        {phase === 'attached' ? null : <p role="status">{phase === 'checking' ? 'Opening Dayflow…' : 'Dayflow is unavailable here right now.'}</p>}
      </div>
    </div>
  </section>;
}
