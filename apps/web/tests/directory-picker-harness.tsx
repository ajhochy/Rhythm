import React from 'react';
import { createRoot } from 'react-dom/client';
import { composeGateway } from '../src/gateway';
import { GatewayProvider } from '../src/gateway/context';
import { FixtureProvider } from '../src/store';
import { SessionRail } from '../src/components/SessionRail';
import '../src/styles.css';

// Like the E21 rail harness, exercise the real live store with intercepted host I/O.
const gateway = composeGateway({
  mode: 'live',
  apiBase: 'http://127.0.0.1:4199', expectedApiBase: 'http://127.0.0.1:4199',
  engineBase: 'http://127.0.0.1:4197', expectedEngineBase: 'http://127.0.0.1:4197',
  productionApiBase: 'https://directory-picker.invalid', taskToken: 'directory-picker-test-only',
});
createRoot(document.getElementById('root')!).render(
  <GatewayProvider gateway={gateway}><FixtureProvider><SessionRail collapsed={false} onToggle={() => {}} selectedProject={null} onSelectProject={() => {}} /></FixtureProvider></GatewayProvider>,
);
