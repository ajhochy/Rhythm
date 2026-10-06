/** Actual API, built fork and MCP; invented external model and ranking responses.
 * Both tests own a stock disposable sandbox and run only with explicit source provenance.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const enabled = process.env.RHYTHM_LIVE_E2E === '1';

describe.skipIf(!enabled)('chat-only finite Coding Workflow through actual native MCP', () => {
  for (const restart of [false, true]) {
    it(`consumes exact same-chat consent after ${restart ? 'stock API/engine restart' : 'idle'}, checks two ordinals and stops`, async () => {
      const sha = process.env.RHYTHM_LIVE_SOURCE_SHA;
      expect(sha, 'RHYTHM_LIVE_SOURCE_SHA must identify the committed candidate').toMatch(/^[a-f0-9]{40}$/);
      const out = path.join(process.env.RHYTHM_CHAT_LIVE_TEST_OUT ?? '/private/tmp', `rhythm-chat-live-${restart ? 'restart' : 'idle'}-${randomUUID()}`);
      const args = ['-B', path.join(root, 'tools/dev/live-chat-bounded-workflow-recon.py'), '--out', out,
        '--qualify-source-sha', sha!];
      if (restart) args.push('--restart-approved-wake');
      const child = spawn('/usr/bin/python3', args, { cwd: root,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', RHYTHM_LIVE_E2E: '1' },
        stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', value => { output += value.toString(); });
      child.stderr.on('data', value => { output += value.toString(); });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject); child.once('exit', resolve);
      });
      const receipt = JSON.parse(await readFile(path.join(out, 'receipt.json'), 'utf8'));
      expect(code, `UNVERIFIED: ${receipt.error ?? output}; receipt ${out}/receipt.json`).toBe(0);
      expect(receipt.qualification).toBe('EXACT_COMMITTED_SOURCE');
      expect(receipt.qualifiedSourceSha).toBe(sha);
      expect(receipt.reconReachedFinalStop).toBe(true);
      expect(receipt.restartApprovedWake).toBe(restart);
      expect(receipt.apiEngineMocked).toBe(false);
      expect(receipt.externalModelSynthetic).toBe(true);
      expect(receipt.semanticRankingSynthetic).toBe(true);
      expect(receipt.privateDataCopied).toBe(false);
      expect(receipt.normalRuntimeTouched).toBe(false);
      expect(receipt.productSourceUnchanged).toBe(true);
      expect(receipt.readonlyFixturesUnchanged).toBe(true);
      expect(receipt.qualificationChecks).toHaveProperty('source_clean_exact_before_after', true);
      expect(Object.values(receipt.qualificationChecks).every(value => value === true)).toBe(true);
      expect(Object.keys(receipt.qualificationChecks)).toHaveLength(restart ? 20 : 19);
      expect(Object.values(receipt.operationalChecks).every(value => value === true)).toBe(true);
      expect(Object.values(receipt.listenerAbsentAfterTeardown)).toEqual(Array(5).fill(true));
    }, 900_000);
  }
});
