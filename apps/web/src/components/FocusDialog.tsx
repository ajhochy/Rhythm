import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../icons';

export function FocusDialog({
  open, title, description, onClose, children, testId, wide = false,
}: {
  open: boolean; title: string; description?: string; onClose(): void; children: React.ReactNode; testId: string; wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
      const target = returnTarget?.isConnected ? returnTarget : document.getElementById('main-content');
      target?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    });
  };

  const requestClose = () => {
    onCloseRef.current();
    scheduleFocusRestore();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = dialogRef.current;
    const activeElement = document.activeElement;
    if (returnFocusRef.current && !returnFocusRef.current.isConnected) returnFocusRef.current = null;
    if (!returnFocusRef.current && activeElement instanceof HTMLElement && !panel?.contains(activeElement)) {
      returnFocusRef.current = document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]') ?? activeElement;
    }
    if (!panel) return;
    if (!panel.open) panel.showModal();
    const candidates = [...panel.querySelectorAll<HTMLElement>('[autofocus], [data-autofocus], button, input, textarea, select, summary, [href], [tabindex]:not([tabindex="-1"])')];
    const explicitFocus = candidates.find((item) => (item.hasAttribute('autofocus') || item.hasAttribute('data-autofocus')) && !item.matches(':disabled') && item.getClientRects().length > 0);
    const focusable = explicitFocus ?? candidates.find((item) => !item.matches(':disabled') && item.getClientRects().length > 0) ?? panel;
    requestAnimationFrame(() => {
      const browserFocus = document.activeElement;
      const validInside = browserFocus instanceof HTMLElement && panel.contains(browserFocus) && !browserFocus.matches(':disabled');
      const browserDefaultClose = browserFocus instanceof HTMLElement && browserFocus.dataset.testid === `${testId}-close`;
      if (!validInside || (explicitFocus && browserDefaultClose)) focusable.focus();
    });
    const containFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) focusable.focus();
    };
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (panel.open) panel.close();
      scheduleFocusRestore();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={dialogRef} className="dialog-backdrop" aria-labelledby={`${testId}-title`} aria-describedby={description ? `${testId}-description` : undefined} onCancel={(event) => { event.preventDefault(); requestClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className={`dialog-panel ${wide ? 'dialog-wide' : ''}`} data-testid={testId}>
        <header className="dialog-header">
          <div>
            <h2 id={`${testId}-title`}>{title}</h2>
            {description && <p id={`${testId}-description`}>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label={`Close ${title}`} data-testid={`${testId}-close`}><Icon name="close" /></button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}
