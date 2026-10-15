import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import '../src/pages/settings/SettingsPage.css';
import '../src/components/ToolWorkspace.css';
import { DayflowDesktopSettings } from '../src/components/tools/DayflowDesktopSettings';
import { DayflowTool } from '../src/components/tools/DayflowTool';

const calls: string[] = [];
const delayed = new URLSearchParams(location.search).has('delayed');
Object.assign(window, {
  __dayflowDesktop: calls,
  rhythmShell: { dayflowDesktop: {
    getDayflowDesktopStatus: async () => {
      calls.push('status');
      if (delayed) await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 'ready' as const, version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' };
    },
    openDayflowDesktop: async () => { calls.push('open'); return { status: 'ready' as const, version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' }; },
  } },
});
const root = createRoot(document.getElementById('root')!);
const toolOnly = new URLSearchParams(location.search).has('tool');
root.render(<main>{toolOnly ? <DayflowTool /> : <><DayflowDesktopSettings /><DayflowTool /></>}</main>);
if (delayed) setTimeout(() => root.unmount(), 1);
