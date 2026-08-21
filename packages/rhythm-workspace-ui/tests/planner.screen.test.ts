import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { PlannerScreen } from '../src/screens/PlannerScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('PlannerScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: PlannerScreen,
      screenName: 'Planner',
      testId: 'rhythm-planner-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('renders the week returned by the injected planner gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(PlannerScreen) }),
    );
    await flush();
    expect(mounted.byTestId('rhythm-planner-day-2026-08-24')?.textContent).toContain('Monday');
    expect(mounted.byTestId('rhythm-planner-day-2026-08-24')?.textContent).toContain('Confirm Sunday greeter schedule');
    mounted.unmount();
  });
});
