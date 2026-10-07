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

// Decode actual JSON tool envelopes without stripping external-content fences.
function messageStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    try { return messageStrings(JSON.parse(value)); } catch { return [value]; }
  }
  if (Array.isArray(value)) return value.flatMap(messageStrings);
  return value && typeof value === 'object' ? Object.values(value).flatMap(messageStrings) : [];
}

function projectionAfter(text: string, prefix: string): Record<string, unknown> | null {
  const index = text.indexOf(prefix);
  if (index === -1) return null;
  const json = text.slice(index + prefix.length).trimStart();
  if (!json.startsWith('{')) throw new Error(`Missing JSON after ${prefix}`);
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(json.slice(0, i + 1));
  }
  throw new Error(`Incomplete JSON after ${prefix}`);
}

function expectServerDates(projection: Record<string, unknown>): void {
  expect(typeof projection.asOf).toBe('string');
  const asOf = new Date(projection.asOf as string);
  expect(Number.isFinite(asOf.valueOf())).toBe(true);
  expect(projection.timeZone).toBe('America/Los_Angeles');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(asOf);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const previousLocalDay = new Date(`${today}T12:00:00.000Z`);
  previousLocalDay.setUTCDate(previousLocalDay.getUTCDate() - 1);
  expect(projection.today).toBe(today);
  expect(projection.yesterday).toBe(previousLocalDay.toISOString().slice(0, 10));
}

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
      const observations = JSON.parse(await readFile(path.join(out, 'model-observations.json'), 'utf8'));
      const snapshots: Record<string, unknown>[] = [], statuses: Record<string, unknown>[] = [];
      for (const input of observations.inputs) {
        for (const message of input.messages ?? input.input ?? []) {
          const prefix = ['system', 'developer'].includes(message.role)
            ? 'Current bounded coordinator snapshot: '
            : message.role === 'tool' ? 'Authoritative coordinator status (read-only): ' : null;
          if (!prefix) continue;
          for (const text of messageStrings(message.content ?? message)) {
            const projection = projectionAfter(text, prefix);
            if (projection) (message.role === 'tool' ? statuses : snapshots).push(projection);
          }
        }
      }
      expect(snapshots.length, 'Actual foreground server snapshot must reach the fork/provider input').toBeGreaterThanOrEqual(1);
      expect(statuses.length, 'Actual signed status tool result must reach the fork/provider input').toBeGreaterThanOrEqual(1);
      for (const projection of [...snapshots, ...statuses]) expectServerDates(projection);
      for (const status of statuses) expect(['authoritative_current_projection', 'bounded_summary']).toContain(status.state);
    }, 900_000);
  }
});
