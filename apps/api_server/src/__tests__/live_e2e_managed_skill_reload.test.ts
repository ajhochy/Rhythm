/** Real API writes and fork discovery across two already-open workspace instances. No model call. */
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';

function endpoint(raw: string | undefined, port: number) {
  const url = new URL(raw ?? '');
  if (url.origin !== `http://127.0.0.1:${port}` || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash)
    throw new Error('Managed skill live gate requires the isolated loopback sandbox');
  return url.origin;
}

(RUN ? describe : describe.skip)('live managed skill shared-library refresh', () => {
  it('create, edit and delete reach both real engine workspace catalogs without a restart', async () => {
    const api = endpoint(process.env.RHYTHM_LIVE_URL, 4098);
    const engine = endpoint(process.env.RHYTHM_LIVE_ENGINE_URL, 4097);
    expect(isAbsolute(SANDBOX) && realpathSync(SANDBOX) === SANDBOX).toBe(true);
    expect(SANDBOX).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(readFileSync(join(SANDBOX, 'opencode_engine.pid'), 'utf8').trim()).toMatch(/^\d+$/);
    const name = `smoke-reload-${randomUUID().replaceAll('-', '')}`;
    const description = `[smoke] private shared skill ${name}`;
    const original = `Private original body ${name}. No commands or external actions.`;
    const edited = `Private edited body ${name}. No commands or external actions.`;
    const file = join(SANDBOX, 'home', '.config', 'opencode', 'skills', name, 'SKILL.md');
    const directories = [join(SANDBOX, `${name}-a`), join(SANDBOX, `${name}-b`)];
    expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
    for (const directory of directories) mkdirSync(directory, { mode: 0o700 });
    const catalog = async (directory: string) => {
      const response = await fetch(`${engine}/skill?directory=${encodeURIComponent(directory)}`,
        { signal: AbortSignal.timeout(15_000) });
      expect(response.status).toBe(200);
      const body = await response.json() as Array<{ name: string; description: string; location: string; content: string }>;
      expect(Array.isArray(body)).toBe(true);
      return body.find(row => row.name === name) ?? null;
    };
    const write = (method: 'POST' | 'PUT', content: string) => fetch(
      `${api}/opencode/skills${method === 'PUT' ? `/${name}` : ''}`, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, description, content }),
        signal: AbortSignal.timeout(15_000),
      });
    try {
      // Both instances must cache the old catalog before the global write.
      for (const directory of directories) expect(await catalog(directory)).toBeNull();
      const created = await write('POST', original);
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({ name, description, location: file, managed: true });
      for (const directory of directories) expect(await catalog(directory))
        .toMatchObject({ name, description, location: file, content: expect.stringContaining(original) });
      const changed = await write('PUT', edited);
      expect(changed.status).toBe(200);
      await changed.json();
      for (const directory of directories) {
        const current = await catalog(directory);
        expect(current?.content).toContain(edited);
        expect(current?.content).not.toContain(original);
      }
      const deleted = await fetch(`${api}/opencode/skills/${name}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
      expect(deleted.status).toBe(204);
      expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
      for (const directory of directories) expect(await catalog(directory)).toBeNull();
    } finally {
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (stat) {
        expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
          && stat.uid === process.getuid?.() && realpathSync(file) === file).toBe(true);
        const text = readFileSync(file, 'utf8');
        expect(text).toContain(`name: ${name}`);
        expect(text.includes(original) || text.includes(edited)).toBe(true);
        expect((await fetch(`${api}/opencode/skills/${name}`, {
          method: 'DELETE', signal: AbortSignal.timeout(15_000),
        })).status).toBe(204);
      }
      expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
      for (const directory of directories) rmdirSync(directory);
    }
  }, 90_000);
});
