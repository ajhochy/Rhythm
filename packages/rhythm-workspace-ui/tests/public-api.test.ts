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

  it('exports the ten specified non-agent screens as public API, not fewer', () => {
    for (const name of NON_AGENT_SCREEN_EXPORTS) {
      expect(name in api, `expected "${name}" to be a public export`).toBe(true);
    }
    expect(NON_AGENT_SCREEN_EXPORTS.length).toBe(10);
  });

  it('resolves package.json main/module/types/exports to a real built dist/ output, not raw src/.(ts|tsx)', async () => {
    const pkg = await import('../package.json');
    expect(pkg.default.main).toBe('./dist/index.cjs');
    expect(pkg.default.module).toBe('./dist/index.js');
    expect(pkg.default.types).toBe('./dist/index.d.ts');
    expect(pkg.default.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.default.exports['.'].require).toBe('./dist/index.cjs');
    expect(pkg.default.exports['.'].types).toBe('./dist/index.d.ts');
    expect(pkg.default.exports['./styles.css']).toBe('./dist/styles/rhythm.css');
    expect(pkg.default.files).toEqual(['dist']);
  });

  it('never runs a dev-only alias-linking or postinstall script — the React 19 matrix is a fully isolated subprocess', async () => {
    const pkg = await import('../package.json');
    const scripts: Record<string, string | undefined> = pkg.default.scripts;
    expect(scripts.postinstall).toBeUndefined();
    expect(scripts).not.toHaveProperty('pretest:react19');
    expect(scripts['test:react19']).toBe('node ./scripts/react19-matrix.mjs');
    expect(pkg.default.devDependencies).not.toHaveProperty('react19');
    expect(pkg.default.devDependencies).not.toHaveProperty('react-dom19');
  });

  it('declares lucide-react as a real dependency, not bundled invisibly into the package via a peer', async () => {
    const pkg = await import('../package.json');
    expect(pkg.default.dependencies).toHaveProperty('lucide-react');
  });
});
