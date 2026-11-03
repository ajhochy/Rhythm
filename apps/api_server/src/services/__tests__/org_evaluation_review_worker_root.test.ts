import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOrgEvaluationWorkerRoot } from '../org_evaluation_review_runner';
import { createOrgEvaluationRuntimeAdapter } from '../org_evaluation_runtime';

describe('Reviewer private worker root', () => {
  it('ignores a non-temporary inherited TMPDIR, admits the real runtime adapter, and cleans only its owned root', () => {
    const previous = process.env.TMPDIR;
    const inherited = resolve(process.cwd());
    process.env.TMPDIR = inherited;
    let root: string | null = null;
    try {
      root = createOrgEvaluationWorkerRoot();
      expect(root).toMatch(/^\/private\/tmp\/rhythm-org-evaluation-/);
      expect(root.startsWith(inherited)).toBe(false);
      expect(existsSync(root)).toBe(true);
      expect(() => createOrgEvaluationRuntimeAdapter({
        engineBinary: '/private/tmp/pinned-opencode', workerBaseRoot: root!,
        model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
        createLease: async () => { throw new Error('No provider call in root-admission test'); },
        getObservedToolCatalog: () => [], finishLease: async () => null,
        enginePort: () => 4797,
      })).not.toThrow();
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
    expect(root && existsSync(root)).toBe(false);
  });
});
