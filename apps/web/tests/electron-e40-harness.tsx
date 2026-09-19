import React from 'react'; import { createRoot } from 'react-dom/client';
import { SettingsPage } from '../src/pages/settings'; import { GatewayProvider } from '../src/gateway/context'; import { AuthUserProvider } from '../src/gateway/auth'; import { FixtureProvider } from '../src/store';
const calls: any[] = []; Object.assign(window, { __e40: calls, rhythmShell: { appVersion: '9.9.9-test', updates: { openDownloadPage: async () => calls.push(['update']) } } });
const query = new URLSearchParams(location.search); const role = query.get('role') === 'staff' ? 'staff' as const : 'admin' as const; const userId = Number(query.get('user') ?? 1); const state = query.get('state') ?? 'ready';
let workspace: { id: number; name: string; role: 'admin' | 'staff'; joinCode?: string } | null = state === 'empty' ? null : { id: 8, name: 'VCRC', role, joinCode: 'OLD' };
const members = [{ userId: 1, name: 'Admin', email: 'admin@example.invalid', photoUrl: null, role: 'admin' as const }, { userId: 2, name: 'Casey', email: 'casey@example.invalid', photoUrl: null, role: 'staff' as const, isFacilitiesManager: false }];
const load = async <T,>(value: T): Promise<T> => {
  if (state === 'loading') return new Promise<T>(() => undefined);
  if (state === 'error') throw new Error('Settings could not be loaded for this workspace.');
  return value;
};
const settings = { workspace: async () => load(workspace), members: async () => load(state === 'empty' ? [] : members), regenerateJoinCode: async () => (workspace = workspace ? { ...workspace, joinCode: 'NEW' } : workspace, { joinCode: 'NEW' }), updateRole: async (...args: any[]) => calls.push(['role', ...args]), removeMember: async (...args: any[]) => calls.push(['remove', ...args]), updateUser: async (...args: any[]) => calls.push(['user', ...args]), updatePreferences: async (...args: any[]) => calls.push(['preferences', ...args]) };
const gateway: any = { mode: 'fixture', environment: null, domains: { settings }, health: { api: async () => ({ service: 'api', state: 'healthy' }), engine: async () => ({ service: 'engine', state: 'healthy' }) }, unsupported: async () => { throw new Error('unsupported'); } };
const auth = { signInWithGoogle: async () => { throw new Error('not used'); }, logout: async () => { calls.push(['logout']); } };
createRoot(document.getElementById('root')!).render(<GatewayProvider gateway={gateway}><AuthUserProvider auth={auth} user={{ id: userId, name: role === 'admin' ? 'Admin' : 'Staff', email: `${role}@example.invalid`, role }}><FixtureProvider><SettingsPage /></FixtureProvider></AuthUserProvider></GatewayProvider>);
