import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../icons';

export function FocusDialog({
  open, title, description, onClose, children, testId, wide = false,
}: {
  open: boolean; title: string; description?: string; onClose(): void; children: React.ReactNode; testId: string; wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  onCloseRef.current = onClose;
  openRef.current = open;

  const scheduleFocusRestore = () => {
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      if (openRef.current) return;
      const returnTarget = returnFocusRef.current;
      if (!returnTarget?.isConnected) {
        returnFocusRef.current = null;
        return;
      }
      returnTarget.focus({ preventScroll: true });
      if (document.activeElement === returnTarget) returnFocusRef.current = null;
    });
  };

  const requestClose = () => {
    onCloseRef.current();
    scheduleFocusRestore();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement;
    if (!returnFocusRef.current && activeElement instanceof HTMLElement && !panel?.contains(activeElement)) {
      returnFocusRef.current = activeElement;
    }
    const focusable = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      scheduleFocusRestore();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={panelRef} className={`dialog-panel ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} aria-describedby={description ? `${testId}-description` : undefined} data-testid={testId}>
        <header className="dialog-header">
          <div>
            <h2 id={`${testId}-title`}>{title}</h2>
            {description && <p id={`${testId}-description`}>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label={`Close ${title}`} data-testid={`${testId}-close`}><Icon name="close" /></button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
