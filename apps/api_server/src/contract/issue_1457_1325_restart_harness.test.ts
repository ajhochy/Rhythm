import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');
const sandbox = readFileSync(resolve(root, 'tools/dev/sandbox.sh'), 'utf8');

describe('#1457/#1325 engine replacement harness', () => {
  it('exposes a sandbox-owned restart-engine command without restarting api_server', () => {
    expect(sandbox).toMatch(/restart-engine\) restart_engine/);
    expect(sandbox).toMatch(/restart_engine\(\)/);
  });

  for (const issue of ['1457_global_stream_retry', '1325']) {
    it(`#${issue.split('_')[0]} invokes restart-engine instead of waiting for an absent replacement`, () => {
      const liveTest = readFileSync(
        resolve(root, `apps/api_server/src/__tests__/issue_${issue}_live_e2e.test.ts`),
        'utf8',
      );
      expect(liveTest).toContain("['restart-engine']");
      expect(liveTest).toContain('execFileSync');
    });
  }
});
