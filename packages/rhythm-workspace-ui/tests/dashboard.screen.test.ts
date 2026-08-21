import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('DashboardScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: DashboardScreen,
      screenName: 'Dashboard',
      testId: 'rhythm-dashboard-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('renders the summary pulled from the injected dashboard gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(DashboardScreen) }),
    );
    await flush();
    expect(mounted.byTestId('rhythm-dashboard-screen')?.textContent).toContain('AJ');
    expect(mounted.byTestId('rhythm-dashboard-open-count')?.textContent).toContain('2');
    mounted.unmount();
  });
});
