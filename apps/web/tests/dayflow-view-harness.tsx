import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import '../src/components/ToolWorkspace.css';
import { DayflowTool } from '../src/components/tools/DayflowTool';

// Synthetic rhythmShell.dayflowView: records calls only. This is not the native host and proves no native pixels.
const mode = new URLSearchParams(location.search).get('mode') ?? 'ok';
const calls: string[] = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const view = {
  getStatus: async () => { calls.push('status'); return mode === 'status-unavailable' ? { state: 'unavailable', code: 'unavailable' } : mode === 'status-malformed' ? { state: 'ready', path: '/x' } : { state: 'ready' }; },
  attach: async () => {
    calls.push('attach');
    if (mode === 'late-attach') await wait(150);
    if (mode === 'denied') return { ok: false, reason: 'denied' };
    if (mode === 'malformed') return { ok: true, attachment: 'leaked-lease' };
    return { ok: true };
  },
  setBounds: async (bounds: { x: number; y: number; width: number; height: number }) => { calls.push(`bounds:${JSON.stringify(bounds)}`); return true; },
  setBlocked: async (blocked: boolean) => { calls.push(`blocked:${blocked}`); return true; },
  detach: async () => { calls.push('detach'); return true; },
  returnFocus: async () => { calls.push('focus'); return true; },
};
Object.assign(window, {
  __dayflowView: calls,
  rhythmShell: {
    ...(mode === 'none' ? {} : { dayflowView: view }),
    // The external opener must never be used as an embedded fallback.
    dayflowDesktop: {
      getDayflowDesktopStatus: async () => { calls.push('legacy-status'); return { status: 'ready', version: '1', build: '1', identifier: 'x' }; },
      openDayflowDesktop: async () => { calls.push('legacy-open'); return { status: 'ready', version: '1', build: '1', identifier: 'x' }; },
    },
  },
});
const root = createRoot(document.getElementById('root')!);
root.render(<main><DayflowTool /></main>);
Object.assign(window, {
  __unmount: () => root.unmount(),
  __setModal: (open: boolean) => {
    document.getElementById('modal')?.remove();
    if (!open) return;
    const dialog = document.createElement('div');
    dialog.id = 'modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
  },
});
if (mode === 'quick-unmount') setTimeout(() => root.unmount(), 10);
if (mode === 'late-attach') setTimeout(() => root.unmount(), 10);
