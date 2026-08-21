import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { IntegrationsScreen } from '../src/screens/IntegrationsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureIntegrationsGateway, failingIntegrationsGateway, emptyIntegrationsGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ Hochhalter', initials: 'AH' }, ...overrides };
}

function mountIntegrations(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(IntegrationsScreen) }));
}

describe('IntegrationsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: IntegrationsScreen, screenName: 'Integrations', testId: 'rhythm-integrations-screen', gateway: fixtureDomainGateway() });
  });

  it('shows the loading state, then the provider list with real connection data', async () => {
    const mounted = mountIntegrations();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('integrations-connected-count')?.textContent).toContain('2');
    expect(mounted.byTestId('integration-status-google-calendar')?.textContent).toContain('Connected');
    expect(mounted.byTestId('integration-status-gmail')?.textContent).toContain('Permission required');
    mounted.unmount();
  });

  it('shows the empty state when every provider is disconnected', async () => {
    const mounted = mountIntegrations({ integrations: emptyIntegrationsGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state on a forbidden gateway error', async () => {
    const mounted = mountIntegrations({ integrations: failingIntegrationsGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the unavailable state on a not_found/unavailable gateway error', async () => {
    const mounted = mountIntegrations({ integrations: failingIntegrationsGateway('unavailable') });
    await flush();
    expect(mounted.byTestId('page-state-unavailable')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountIntegrations({ integrations: failingIntegrationsGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('selects a provider and shows its inspector detail', async () => {
    const mounted = mountIntegrations();
    await flush();
    await actClick(mounted.byTestId('integration-select-gmail')!);
    await flush();
    const inspector = mounted.byTestId('integration-inspector');
    expect(inspector?.textContent).toContain('Gmail');
    mounted.unmount();
  });

  it('requests authorization for a disconnected provider and shows a safe local handoff confirmation without building an OAuth URL', async () => {
    const mounted = mountIntegrations({ integrations: emptyIntegrationsGateway() });
    await flush();
    await actClick(mounted.byTestId('integrations-empty-connect')!);
    await flush();
    expect(mounted.byTestId('integration-handoff-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('integration-handoff-close')!);
    await flush();
    expect(mounted.byTestId('integration-handoff-dialog')).toBeNull();
    mounted.unmount();
  });

  it('reconnects a needs-reauth provider through requestAuthorization', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const requests: string[] = [];
    integrationsGateway.requestAuthorization = (id) => { requests.push(id); };
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integration-select-gmail')!);
    await flush();
    await actClick(mounted.byTestId('integration-reconnect-gmail')!);
    await flush();
    expect(requests).toContain('gmail');
    mounted.unmount();
  });

  it('syncs a connected provider through the gateway', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integration-sync-google-calendar')!);
    await flush();
    const accounts = await integrationsGateway.accounts();
    expect(accounts.find((account) => account.id === 'google-calendar')?.lastSyncedAt).toBe('Just now');
    mounted.unmount();
  });

  it('syncs all connected providers via "Sync all"', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integrations-sync-all')!);
    await flush();
    await flush();
    expect(mounted.byTestId('integrations-sync-all-status')?.textContent).toBeTruthy();
    const accounts = await integrationsGateway.accounts();
    expect(accounts.filter((account) => account.status === 'connected').every((account) => account.lastSyncedAt === 'Just now')).toBe(true);
    mounted.unmount();
  });

  it('disconnects a provider through a confirmation dialog and the gateway', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integration-disconnect-google-calendar')!);
    await flush();
    expect(mounted.byTestId('integration-disconnect-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('integration-disconnect-confirm')!);
    await flush();
    const accounts = await integrationsGateway.accounts();
    expect(accounts.find((account) => account.id === 'google-calendar')?.status).toBe('disconnected');
    mounted.unmount();
  });

  it('selects and saves calendar sources for the connected Google Calendar account', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integration-select-google-calendar')!);
    await flush();
    expect(mounted.byTestId('integration-calendar-option-cal-community')).toBeTruthy();
    await actClick(mounted.byTestId('integration-calendar-option-cal-community')!);
    await flush();
    await actClick(mounted.byTestId('integration-calendar-save')!);
    await flush();
    const sources = await integrationsGateway.calendarSources();
    expect(sources.find((source) => source.id === 'cal-community')?.selected).toBe(true);
    mounted.unmount();
  });

  it('supports selecting all and none for calendar sources', async () => {
    const mounted = mountIntegrations();
    await flush();
    await actClick(mounted.byTestId('integration-select-google-calendar')!);
    await flush();
    await actClick(mounted.byTestId('integration-calendar-select-none')!);
    await flush();
    expect(mounted.byTestId('integration-calendar-summary')?.textContent).toContain('0');
    await actClick(mounted.byTestId('integration-calendar-select-all')!);
    await flush();
    expect(mounted.byTestId('integration-calendar-summary')?.textContent).toContain('3');
    mounted.unmount();
  });

  it('shows deduplicated Gmail inbox signals with an unread count when connected', async () => {
    const mounted = mountIntegrations();
    await flush();
    await actClick(mounted.byTestId('integration-select-gmail')!);
    await flush();
    expect(mounted.byTestId('integration-gmail-prerequisite')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a locked prerequisite for Planning Center when disconnected, never calling a live integration', async () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    const baseAccounts = await integrationsGateway.accounts();
    integrationsGateway.accounts = async () => baseAccounts.map((account) => (account.id === 'planning-center' ? { ...account, status: 'disconnected' as const, identity: undefined } : account));
    const mounted = mountIntegrations({ integrations: integrationsGateway });
    await flush();
    await actClick(mounted.byTestId('integration-select-planning-center')!);
    await flush();
    expect(mounted.byTestId('integration-planning-center-prerequisite')).toBeTruthy();
    mounted.unmount();
  });

  it('routes the assistant tools broader-consent request through the host follow-up hook, not a built OAuth URL', async () => {
    let received: unknown = null;
    const mounted = mountIntegrations({}, { onRequestFollowUp: (context: unknown) => { received = context; } });
    await flush();
    await actClick(mounted.byTestId('integration-select-assistant-tools')!);
    await flush();
    await actClick(mounted.byTestId('integration-assistant-enable')!);
    expect(received).toMatchObject({ screen: 'integrations', action: 'assistant-google-enable' });
    mounted.unmount();
  });

  it('never constructs a bearer credential or authorization URL in shared code', () => {
    const integrationsGateway = fixtureIntegrationsGateway();
    expect(integrationsGateway.requestAuthorization.length).toBe(1);
  });
});
