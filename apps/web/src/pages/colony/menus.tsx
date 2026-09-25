import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ColonyThread } from './model';

export type ColonyViewState = {
  quality: 'auto' | 'high' | 'balanced' | 'low';
  sound: boolean;
  motion: 'full' | 'reduced';
};

export type ColonyViewChange = Partial<ColonyViewState> & { resetCamera?: boolean; focusSelection?: boolean };

function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)'));
  if (!items.length) return;
  event.preventDefault();
  const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

function ColonyMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard, true);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)')?.focus());
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', keyboard, true); };
  }, [open]);
  return <div className="colony-menu-anchor" ref={root}>
    <button ref={trigger} type="button" className="secondary-button compact" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => open ? close(false) : setOpen(true)}>{label === 'View options' ? 'View' : 'More'}</button>
    {open && <div className="menu-popover colony-menu" role="menu" aria-label={label} onKeyDown={moveMenuFocus} onClick={(event) => {
      if ((event.target as HTMLElement).closest('button[role^="menuitem"]')) close(true);
    }}>{children}</div>}
  </div>;
}

export function ColonyViewMenu({ hasSelection, sceneAvailable, state, onView }: {
  hasSelection: boolean;
  sceneAvailable: boolean;
  state: ColonyViewState;
  onView(change: ColonyViewChange): void;
}) {
  const unavailable = 'Unavailable in the current embedded scene';
  return <ColonyMenu label="View options">
    <button type="button" role="menuitem" disabled={!sceneAvailable} onClick={() => onView({ resetCamera: true })}>Reset camera</button>
    <button type="button" role="menuitem" disabled={!sceneAvailable || !hasSelection} onClick={() => onView({ focusSelection: true })}>Focus selected bot</button>
    <button type="button" role="menuitemcheckbox" aria-checked={state.motion === 'reduced'} disabled={!sceneAvailable} onClick={() => onView({ motion: state.motion === 'reduced' ? 'full' : 'reduced' })}>Reduced motion</button>
    <button type="button" role="menuitemcheckbox" aria-checked={state.sound} disabled={!sceneAvailable} onClick={() => onView({ sound: !state.sound })}>Ambient sound</button>
    {(['auto', 'high', 'balanced', 'low'] as const).map((quality) => <button key={quality} type="button" role="menuitemradio" aria-checked={state.quality === quality} disabled={!sceneAvailable} onClick={() => onView({ quality })}>Quality: {quality[0].toUpperCase() + quality.slice(1)}</button>)}
    <button type="button" role="menuitem" disabled title={unavailable}>Keyboard help unavailable</button>
    <button type="button" role="menuitem" disabled title={unavailable}>Focus scene unavailable</button>
    <button type="button" role="menuitem" disabled title={unavailable}>Orbit unavailable</button>
    <button type="button" role="menuitem" disabled title={unavailable}>Planet unavailable</button>
    <button type="button" role="menuitem" disabled title={unavailable}>Time of day unavailable</button>
    <button type="button" role="menuitem" disabled title="The embedded scene protocol does not expose an owned save path.">Screenshot unavailable</button>
  </ColonyMenu>;
}

export function ColonyTaskMenu({ thread, onAction }: { thread: ColonyThread; onAction(kind: 'reveal' | 'copyPath' | 'viewed' | 'archive' | 'restore'): void }) {
  const folderMissing = thread.checkout?.missing === true || !thread.checkout?.path;
  return <ColonyMenu label="Task actions">
    <button type="button" role="menuitem" onClick={() => onAction('viewed')}>Mark viewed</button>
    <button type="button" role="menuitem" disabled={thread.archived === true} onClick={() => onAction('archive')}>Archive from Colony</button>
    <button type="button" role="menuitem" disabled={thread.archived !== true} onClick={() => onAction('restore')}>Restore to Colony</button>
    <button type="button" role="menuitem" disabled={folderMissing} onClick={() => onAction('reveal')}>Show in Finder</button>
    <button type="button" role="menuitem" disabled={folderMissing} onClick={() => onAction('copyPath')}>Copy path</button>
  </ColonyMenu>;
}
