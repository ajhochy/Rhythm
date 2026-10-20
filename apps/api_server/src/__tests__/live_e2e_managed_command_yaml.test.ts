/** Real API + engine catalog proof for managed Playbook YAML strings. Never invokes a command. */
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_URL ?? '';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const FIXTURE = process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '';

function privateEndpoint(raw: string, expectedPort: number): string {
  const value = new URL(raw);
  if (value.protocol !== 'http:' || value.hostname !== '127.0.0.1'
    || Number(value.port) !== expectedPort || value.username || value.password
    || value.search || value.hash || value.pathname !== '/')
    throw new Error(`Live managed-command gate requires loopback sandbox :${expectedPort}`);
  return value.origin;
}

async function engineCommand(name: string): Promise<{ status: number; item: Record<string, unknown> | null }> {
  const response = await fetch(`${privateEndpoint(ENGINE, 4097)}/command`, { signal: AbortSignal.timeout(10_000) });
  const body: unknown = await response.json();
  return { status: response.status, item: Array.isArray(body)
    ? (body.find(item => item && typeof item === 'object' && item.name === name) ?? null)
    : null };
}

(RUN ? describe : describe.skip)('live managed Playbook YAML strings', () => {
  it('normal API create reaches the real engine catalog with a literal bracketed description', async () => {
    const api = privateEndpoint(API, 4098);
    privateEndpoint(ENGINE, 4097);
    expect(isAbsolute(SANDBOX) && realpathSync(SANDBOX) === SANDBOX).toBe(true);
    expect(isAbsolute(FIXTURE) && realpathSync(FIXTURE) === FIXTURE).toBe(true);
    expect(SANDBOX).not.toBe(FIXTURE);
    expect(readFileSync(join(SANDBOX, 'opencode_engine.pid'), 'utf8').trim()).toMatch(/^\d+$/);
    const name = `smoke-yaml-${randomUUID().replaceAll('-', '')}`;
    const description = `[smoke] inert YAML description ${name}`;
    const template = `[smoke] inert body ${name}. Never invoke.`;
    const file = join(SANDBOX, 'home', '.config', 'opencode', 'commands', `${name}.md`);
    expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
    let created = false;
    try {
      const response = await fetch(`${api}/opencode/commands`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, template }), signal: AbortSignal.timeout(15_000) });
      created = response.status === 200;
      const body = await response.json() as { name: string; template: string; frontmatter: { description: string } };
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ name, template, frontmatter: { description } });
      const stat = lstatSync(file);
      expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
        && stat.uid === process.getuid?.() && realpathSync(file) === file).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain(JSON.stringify(description));

      let catalog = await engineCommand(name);
      for (let attempt = 0; attempt < 8 && !catalog.item; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        catalog = await engineCommand(name);
      }
      expect(catalog.status).toBe(200);
      expect(catalog.item).toMatchObject({ name, description, template, source: 'command' });
    } finally {
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (stat) {
        expect(created, 'refusing to delete a command this test did not create').toBe(true);
        expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
          && stat.uid === process.getuid?.() && realpathSync(file) === file).toBe(true);
        const raw = readFileSync(file, 'utf8');
        expect(raw).toContain(template);
        expect(raw).toContain(JSON.stringify(description));
        const deleted = await fetch(`${api}/opencode/commands/${name}`, { method: 'DELETE',
          signal: AbortSignal.timeout(15_000) });
        expect(deleted.status).toBe(204);
        expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
        expect((await engineCommand(name)).item).toBeNull();
      }
    }
  });
});
