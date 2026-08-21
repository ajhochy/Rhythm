import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { AutomationsScreen } from '../src/screens/AutomationsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureAutomationsGateway } from './test-utils/fixtureGateway';
import { mount, flush, actClick } from './test-utils/mount';

describe('AutomationsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: AutomationsScreen,
      screenName: 'Automations',
      testId: 'rhythm-automations-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lets a user enable an automation through the injected gateway', async () => {
    const automations = fixtureAutomationsGateway();
    const gateway = { ...fixtureDomainGateway(), automations };
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(AutomationsScreen) }),
    );
    await flush();
    const toggle = mounted.byTestId('rhythm-automation-toggle-a1') as HTMLInputElement | null;
    expect(toggle?.checked).toBe(false);
    await actClick(toggle!);
    await flush();
    const updated = await automations.list();
    expect(updated.find((automation) => automation.id === 'a1')?.enabled).toBe(true);
    mounted.unmount();
  });
});
