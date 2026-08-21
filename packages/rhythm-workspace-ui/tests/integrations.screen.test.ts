import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { IntegrationsScreen } from '../src/screens/IntegrationsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureIntegrationsGateway } from './test-utils/fixtureGateway';
import { mount, flush, actClick } from './test-utils/mount';

describe('IntegrationsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: IntegrationsScreen,
      screenName: 'Integrations',
      testId: 'rhythm-integrations-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lets a user toggle a connection through the injected gateway', async () => {
    const integrations = fixtureIntegrationsGateway();
    const gateway = { ...fixtureDomainGateway(), integrations };
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(IntegrationsScreen) }),
    );
    await flush();
    const toggle = mounted.byTestId('rhythm-integration-toggle-pco') as HTMLButtonElement | null;
    expect(toggle?.textContent).toContain('Disconnect');
    await actClick(toggle!);
    await flush();
    const updated = await integrations.list();
    expect(updated.find((integration) => integration.id === 'pco')?.connected).toBe(false);
    mounted.unmount();
  });
});
