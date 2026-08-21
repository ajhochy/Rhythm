import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { MessagesScreen } from '../src/screens/MessagesScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('MessagesScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: MessagesScreen,
      screenName: 'Messages',
      testId: 'rhythm-messages-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lists message threads with unread counts from the injected gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(MessagesScreen) }),
    );
    await flush();
    const row = mounted.byTestId('rhythm-thread-row-m1');
    expect(row?.textContent).toContain('Sunday setup');
    expect(row?.textContent).toContain('1');
    mounted.unmount();
  });
});
