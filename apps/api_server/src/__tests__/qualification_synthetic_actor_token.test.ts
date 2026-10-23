import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, linkSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { qualificationSyntheticActorToken, type QualificationFixtureAuthority } from '../services/qualification_fixture_authority';

let root: string | undefined;
afterEach(() => {
  vi.useRealTimers();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function actor() {
  root = mkdtempSync('/private/tmp/rhythm-fixture-actor-token-');
  const token = randomBytes(32).toString('hex');
  const tokenPath = join(root, 'actor-token');
  writeFileSync(tokenPath, token, { mode: 0o600 });
  const authority = {
    fixtureRoot: root,
    tokenSha256: createHash('sha256').update(token).digest('hex'),
    syntheticActor: { tokenPath, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  } as QualificationFixtureAuthority;
  expect(qualificationSyntheticActorToken(authority)).toBe(token);
  return { token, tokenPath, authority };
}

it('rejects a previously accepted token after its private file becomes world-readable', () => {
  const { tokenPath, authority } = actor();
  chmodSync(tokenPath, 0o644);
  expect(() => qualificationSyntheticActorToken(authority)).toThrow();
});

it('rejects a same-byte symlink or hard link after an earlier accepted read', () => {
  const { tokenPath, authority } = actor();
  const moved = join(root!, 'moved-token');
  renameSync(tokenPath, moved);
  symlinkSync(moved, tokenPath);
  expect(() => qualificationSyntheticActorToken(authority)).toThrow();
  rmSync(tokenPath);
  renameSync(moved, tokenPath);
  linkSync(tokenPath, join(root!, 'other-link'));
  expect(() => qualificationSyntheticActorToken(authority)).toThrow();
});

it('rejects a token after its startup expiry, even when its bytes are unchanged', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  const { authority } = actor();
  vi.advanceTimersByTime(60_001);
  expect(() => qualificationSyntheticActorToken(authority)).toThrow();
});
