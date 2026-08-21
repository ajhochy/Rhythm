import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { FacilitiesScreen } from '../src/screens/FacilitiesScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('FacilitiesScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: FacilitiesScreen,
      screenName: 'Facilities',
      testId: 'rhythm-facilities-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lists facility requests with status from the injected gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(FacilitiesScreen) }),
    );
    await flush();
    const row = mounted.byTestId('rhythm-facility-row-f1');
    expect(row?.textContent).toContain('Fellowship Hall');
    expect(row?.textContent).toContain('requested');
    mounted.unmount();
  });
});
