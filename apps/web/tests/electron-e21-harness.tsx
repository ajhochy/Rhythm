import React from 'react';
import { createRoot } from 'react-dom/client';
import { composeGateway } from '../src/gateway';
import { GatewayProvider } from '../src/gateway/context';
import { FixtureProvider, useFixtures } from '../src/store';
import { SessionRail } from '../src/components/SessionRail';
import '../src/styles.css';

const env = import.meta.env;
const gateway = composeGateway({ mode: 'live', apiBase: env.VITE_RHYTHM_API_BASE, expectedApiBase: env.VITE_RHYTHM_API_BASE, engineBase: env.VITE_RHYTHM_ENGINE_BASE, expectedEngineBase: env.VITE_RHYTHM_ENGINE_BASE, productionApiBase: env.VITE_RHYTHM_PRODUCTION_API_BASE, taskToken: env.VITE_RHYTHM_LIVE_TOKEN });
function Probe() {
  const state = useFixtures();
  return <><SessionRail collapsed={false} onToggle={() => {}} selectedProject={null} onSelectProject={() => {}} /><pre data-testid="state">{JSON.stringify({ sessions: state.sessions, selectedId: state.selectedId, selected: state.selected, toast: state.toast })}</pre>
    <button onClick={() => state.updateSession(state.selectedId, { pendingAttachments: [{ id: 'pending', type: 'text', path: 'note', filename: 'note', mime: 'text/plain', size: 4, truncated: false }], queuedDraft: 'draft' })}>Prepare draft</button>
    <button onClick={() => state.sendLiveInput('must not reroute')}>Send probe</button>
    <button onClick={() => void state.refreshLiveSessions()}>Refresh probe</button></>;
}
createRoot(document.getElementById('root')!).render(<GatewayProvider gateway={gateway}><FixtureProvider><Probe /></FixtureProvider></GatewayProvider>);
