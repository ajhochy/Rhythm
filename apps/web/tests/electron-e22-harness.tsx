import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { composeGateway } from '../src/gateway';
import { GatewayProvider } from '../src/gateway/context';
import { AuthUserProvider } from '../src/gateway/auth';
import { FixtureProvider, useFixtures } from '../src/store';
import { AgentsWorkspace } from '../src/components/AgentsWorkspace';
import { Profiles } from '../src/components/Profiles';
import '../src/styles.css';
const env = import.meta.env;
const fixtureGateway = new URLSearchParams(location.search).get('gateway') === 'fixture';
const gateway = composeGateway(fixtureGateway ? { mode: 'fixture' } : { mode: 'live', apiBase: env.VITE_RHYTHM_API_BASE, expectedApiBase: env.VITE_RHYTHM_API_BASE, engineBase: env.VITE_RHYTHM_ENGINE_BASE, expectedEngineBase: env.VITE_RHYTHM_ENGINE_BASE, productionApiBase: env.VITE_RHYTHM_PRODUCTION_API_BASE, taskToken: env.VITE_RHYTHM_LIVE_TOKEN });
function Probe() {
  const state = useFixtures(); const [profiles, showProfiles] = useState(false);
  return <><button onClick={() => showProfiles(!profiles)}>Switch surface</button><div style={{ height: '850px' }}>{profiles ? <Profiles /> : <AgentsWorkspace />}</div><output data-testid="notice">{state.toast.message}</output><pre data-testid="state">{JSON.stringify({ profiles: state.profiles, selected: state.selected })}</pre></>;
}
createRoot(document.getElementById('root')!).render(<AuthUserProvider user={{ id: 4189, name: 'E22', email: 'e22@example.invalid', role: 'user' }}><GatewayProvider gateway={gateway}><FixtureProvider><Probe /></FixtureProvider></GatewayProvider></AuthUserProvider>);
