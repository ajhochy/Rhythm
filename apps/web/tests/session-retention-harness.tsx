import React from 'react'; import { createRoot } from 'react-dom/client';
import { SettingsPage } from '../src/pages/settings'; import { GatewayProvider } from '../src/gateway/context'; import { AuthUserProvider } from '../src/gateway/auth'; import { FixtureProvider } from '../src/store';
import '../src/styles.css';
import { createLiveRuntimeGateway, type SessionRetentionMode, type SessionRetentionState } from '../src/gateway/runtime';
// ?api=http://127.0.0.1:PORT drives a real (test) api_server; otherwise an in-memory fake records PUTs.
const query = new URLSearchParams(location.search); const calls: SessionRetentionMode[] = []; Object.assign(window, { __retention: calls });
let state: SessionRetentionState = { mode: 'dry-run', source: query.get('source') === 'env' ? 'env' : 'default', setting: null,
  ...(query.get('report') === '1' ? { lastReport: { mode: 'dry-run', finishedAt: '2026-09-29T09:15:00.000Z', reclaimableBytes: { engine: 1_930_000_000, rhythm: 512_000_000 }, rowsWritten: { engine: 0, rhythm: 0 } } } : {}) };
const fake = { mode: 'fixture', get: async () => { throw new Error('unused'); }, restartEngine: async () => { throw new Error('unused'); },
  sessionRetention: async () => state,
  setSessionRetention: async (mode: SessionRetentionMode) => { calls.push(mode); state = { ...state, setting: mode, mode: state.source === 'env' ? state.mode : mode, source: state.source === 'env' ? 'env' : 'setting' }; return state; } };
const api = query.get('api'); const runtime = api ? createLiveRuntimeGateway(api) : fake;
const settings = { workspace: async () => ({ id: 8, name: 'VCRC', role: 'admin' as const }), members: async () => [] };
const gateway: any = { mode: 'fixture', environment: null, domains: { settings, runtime }, health: { api: async () => ({ service: 'api', state: 'healthy' }), engine: async () => ({ service: 'engine', state: 'healthy' }) }, unsupported: async () => { throw new Error('unsupported'); } };
createRoot(document.getElementById('root')!).render(<GatewayProvider gateway={gateway}><AuthUserProvider auth={{ signInWithGoogle: async () => { throw new Error('not used'); } }} user={{ id: 1, name: 'Admin', email: 'admin@example.invalid', role: 'admin' }}><FixtureProvider><SettingsPage /></FixtureProvider></AuthUserProvider></GatewayProvider>);
