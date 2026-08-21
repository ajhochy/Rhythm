import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { ProjectsScreen } from '../src/screens/ProjectsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

describe('ProjectsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: ProjectsScreen,
      screenName: 'Projects',
      testId: 'rhythm-projects-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lists projects from the injected projects gateway', async () => {
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(ProjectsScreen) }),
    );
    await flush();
    expect(mounted.byTestId('rhythm-project-row-p1')?.textContent).toContain('Fall retreat planning');
    expect(mounted.byTestId('rhythm-project-row-p1')?.textContent).toContain('40%');
    mounted.unmount();
  });
});
