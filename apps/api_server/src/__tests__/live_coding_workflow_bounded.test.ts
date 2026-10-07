/** Real API + fork + MCP workflow; only the external model response is synthetic.
 * Opt-in because this builds and owns an isolated disposable sandbox.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const enabled = process.env.RHYTHM_LIVE_E2E === '1';

describe.skipIf(!enabled)('bounded Coding Workflow over the real API and fork', () => {
  it('checks both delivered criteria, one reviewer and exactly two ordinals, then stops across replay and reconciliation', async () => {
    const out = process.env.RHYTHM_G2_LIVE_TEST_OUT ?? path.join('/private/tmp', 'rhythm-g2-live-receipt-' + randomUUID());
    const child = spawn('/usr/bin/python3', ['-B', path.join(root, 'tools/dev/live-coding-workflow-s8.py'), '--out', out], {
      cwd: root,
      // No parent credentials, live DB/config or engine routing is inherited.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', RHYTHM_LIVE_E2E: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', value => { output += value.toString(); });
    child.stderr.on('data', value => { output += value.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    const receipt = JSON.parse(await readFile(path.join(out, 'receipt.json'), 'utf8'));
    expect(code, `UNVERIFIED: ${receipt.error ?? output} — receipt ${out}/receipt.json`).toBe(0);
    expect(receipt.reconReachedFinalStop).toBe(true);
    expect(receipt.externalModelSynthetic).toBe(true);
    expect(receipt.apiEngineMocked).toBe(false);
    expect(receipt.privateDataCopied).toBe(false);
    expect(receipt.normalRuntimeTouched).toBe(false);
    expect(Object.values(receipt.qualificationChecks)).toEqual(Array(Object.keys(receipt.qualificationChecks).length).fill(true));
    expect(Object.keys(receipt.qualificationChecks)).toHaveLength(17);
    expect(receipt.productSourceUnchanged).toBe(true);
    expect(Object.values(receipt.listenerAbsentAfterTeardown)).toEqual(Array(5).fill(true));
  }, 900_000);
});
