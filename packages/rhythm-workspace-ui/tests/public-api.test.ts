import { describe, expect, it } from 'vitest';
import * as api from '../src/index';

const NON_AGENT_SCREEN_EXPORTS = [
  'DashboardScreen',
  'TasksScreen',
  'PlannerScreen',
  'ProjectsScreen',
  'RhythmsScreen',
  'MessagesScreen',
  'FacilitiesScreen',
  'IntegrationsScreen',
  'AutomationsScreen',
  'ArtifactsScreen',
] as const;

describe('package public API surface (src/index.ts)', () => {
  it('exports exactly the ten specified non-agent screens as components', () => {
    for (const name of NON_AGENT_SCREEN_EXPORTS) {
      expect(typeof api[name], `expected "${name}" to be exported as a function component`).toBe('function');
    }
  });

  it('exports the composition root and its hooks', () => {
    expect(typeof api.RhythmWorkspaceProvider).toBe('function');
    expect(typeof api.useRhythmDomainGateway).toBe('function');
    expect(typeof api.useRhythmHost).toBe('function');
  });

  it('exports the default host tokens and scoping class used to theme a host-mounted screen', () => {
    expect(typeof api.mapHostTokens).toBe('function');
    expect(typeof api.defaultRhythmTokens).toBe('object');
    expect(api.RHYTHM_ROOT_CLASS).toBe('rhythm-workspace-root');
  });

  it('resolves package.json main/types/exports to this same module, so a consumer importing the package name gets this surface', async () => {
    const pkg = await import('../package.json');
    expect(pkg.default.main).toBe('./src/index.ts');
    expect(pkg.default.exports['.']).toBe('./src/index.ts');
  });
});
