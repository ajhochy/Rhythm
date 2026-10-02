import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDayflowManagementAdapter } from '../integrations/dayflow/management_adapter';
import { DayflowIntegrationService } from '../integrations/dayflow/service';
import type { VerifiedDayflowArtifact } from '../integrations/dayflow/cli_source';
import type { DayflowSource } from '../integrations/dayflow/types';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bindingFixture() {
  const root = mkdtempSync(join(tmpdir(), 'rhythm-dayflow-binding-'));
  roots.push(root);
  const bundle = join(root, 'Dayflow.app');
  const executable = join(bundle, 'Contents', 'Helpers', 'dayflow');
  mkdirSync(join(bundle, 'Contents', 'Helpers'), { recursive: true });
  writeFileSync(executable, 'synthetic helper fixture; never executed\n');

  const source = {
    read: async () => ({ contractVersion: 'fixture-v1' as const, sourceInstanceId: 'synthetic', records: [] }),
    hasVerifiedBinding: () => true,
  } as DayflowSource;
  const artifactVerifier = {
    verify: async (path: string): Promise<VerifiedDayflowArtifact> => ({
      canonicalPath: path,
      executable: join(path, 'Contents', 'Helpers', 'dayflow'),
      bundleId: 'teleportlabs.com.Dayflow',
      version: '2.6.0',
      build: 133,
      fileIdentity: 'synthetic-file-identity',
      digest: 'synthetic-pinned-digest',
      signingFingerprint: 'synthetic-signature',
    }),
  };
  const service = new DayflowIntegrationService({
    source,
    memoryClient: { create: async () => ({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }), remove: async () => {} },
    artifactVerifier,
    sourceForArtifact: () => source,
  });
  return { adapter: createDayflowManagementAdapter(service), bundle };
}

describe('Dayflow management selection binding lifecycle', () => {
  it('invalidates a checked token after config changes, then applies the current selection disabled before explicit enable', async () => {
    const { adapter, bundle } = bindingFixture();
    const stale = await adapter.checkReadiness({ bundlePath: bundle });
    expect(stale).toMatchObject({ state: 'ready' });
    expect(stale.selectionToken).toBeDefined();
    await adapter.updateConfig({ exclusions: ['category:private'] });
    await expect(adapter.updateConfig({ sourceSelectionToken: stale.selectionToken! })).rejects.toThrow('SOURCE_CHANGED');

    const current = await adapter.checkReadiness({ bundlePath: bundle });
    const applied = await adapter.updateConfig({ sourceSelectionToken: current.selectionToken!, timezone: 'UTC', enabled: true });
    expect(applied).toMatchObject({ enabled: false, timezone: 'UTC', source: { label: 'Dayflow', version: '2.6.0', build: '133' } });

    await adapter.updateConfig({ exclusions: ['category:private', 'category:secret'] });
    await expect(adapter.updateConfig({ enabled: true })).resolves.toMatchObject({ enabled: true });
  });
});
