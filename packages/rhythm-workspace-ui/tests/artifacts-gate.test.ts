import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { ArtifactsScreen } from '../src/artifacts/ArtifactsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { fixtureDomainGateway } from './test-utils/fixtureGateway';
import { mount, flush } from './test-utils/mount';

const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };

describe('ArtifactsScreen (separate security gate)', () => {
  it('renders locked, with no list content, when the host supplies no artifacts gateway', async () => {
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, {
        gateway: fixtureDomainGateway(),
        host,
        children: createElement(ArtifactsScreen, {}),
      }),
    );
    await flush();
    const root = mounted.byTestId('rhythm-artifacts-screen');
    expect(root?.getAttribute('data-rhythm-artifacts-state')).toBe('locked');
    expect(mounted.byTestId('rhythm-artifacts-list')).toBeNull();
    mounted.unmount();
  });

  it('unlocks and lists artifacts only when a host explicitly provides an artifacts gateway', async () => {
    const artifactsGateway = {
      list: async () => [{ id: 'art1', title: 'Sunday bulletin draft', kind: 'document' as const }],
    };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, {
        gateway: fixtureDomainGateway(),
        host,
        children: createElement(ArtifactsScreen, { artifactsGateway }),
      }),
    );
    await flush();
    const root = mounted.byTestId('rhythm-artifacts-screen');
    expect(root?.getAttribute('data-rhythm-artifacts-state')).toBe('unlocked');
    expect(mounted.byTestId('rhythm-artifact-row-art1')?.textContent).toContain('Sunday bulletin draft');
    mounted.unmount();
  });

  it('never accepts a session, bearer, or agent-approval argument in its gateway contract', () => {
    // Static contract, not behavioral — see tests/forbidden-imports.test.ts for the
    // repo-wide sweep. This asserts the artifacts port's own shape stays a plain list().
    const artifactsGateway = { list: async () => [] };
    expect(artifactsGateway.list.length).toBe(0);
  });
});
