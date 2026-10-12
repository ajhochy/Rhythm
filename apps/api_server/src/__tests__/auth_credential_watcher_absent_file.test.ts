/**
 * Regression guard: the credential watcher must survive a profile that has
 * not signed in yet.
 *
 * A fresh profile has no auth.json. fs.watch on a missing path throws ENOENT,
 * and the watcher used to swallow that and return a dead handle while still
 * logging "watching <path>". The first successful sign-in — the one moment
 * the credentials actually change — therefore fired nothing, and the router
 * catalogue kept no models for that provider until the next relaunch.
 *
 * This exercises the REAL fs-backed watch implementation. Stubbing the watch
 * dependency is what let the gap survive: the injected fake always attached.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAuthCredentialWatcherDeps } from '../services/auth_credential_watcher';

let dir: string;
const handles: Array<{ close(): void }> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rhythm-auth-watch-'));
});

afterEach(() => {
  while (handles.length) handles.pop()!.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Resolves on the first watch event, or rejects after `ms`. */
function firstEvent(path: string, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no watch event fired')), ms);
    const handle = defaultAuthCredentialWatcherDeps.watch(path, () => {
      clearTimeout(timer);
      resolve();
    });
    handles.push(handle);
  });
}

it('fires when a missing credentials file is created by a first sign-in', async () => {
  const path = join(dir, 'auth.json');
  const fired = firstEvent(path);
  // Give the directory watch a moment to attach before the file appears.
  await new Promise(r => setTimeout(r, 150));
  writeFileSync(path, JSON.stringify({ openai: { type: 'oauth', refresh: 'r' } }));
  await expect(fired).resolves.toBeUndefined();
});

it('still fires on a later write once the file exists', async () => {
  const path = join(dir, 'auth.json');
  writeFileSync(path, JSON.stringify({ openai: { type: 'oauth', refresh: 'one' } }));
  const fired = firstEvent(path);
  await new Promise(r => setTimeout(r, 150));
  writeFileSync(path, JSON.stringify({ openai: { type: 'oauth', refresh: 'two' } }));
  await expect(fired).resolves.toBeUndefined();
});
