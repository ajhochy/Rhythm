import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { RhythmsScreen } from '../src/screens/RhythmsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('RhythmsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: RhythmsScreen,
      screenName: 'Rhythms',
      testId: 'rhythm-rhythms-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lists rhythms with cadence and next occurrence from the injected gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(RhythmsScreen) }),
    );
    await flush();
    const row = mounted.byTestId('rhythm-rhythm-row-r1');
    expect(row?.textContent).toContain('Weekly staff huddle');
    expect(row?.textContent).toContain('weekly');
    mounted.unmount();
  });
});
