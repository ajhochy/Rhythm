/**
 * #1332 — a test build must never orphan real conversations.
 *
 * The engine names its session database after the installation channel
 * (fork: `packages/opencode/src/storage/db.ts`, `getChannelPath`):
 *
 *   latest | beta | prod            -> opencode.db
 *   anything else                   -> opencode-<channel>.db
 *   OPENCODE_DISABLE_CHANNEL_DB set -> opencode.db  (regardless of channel)
 *   OPENCODE_DB set                 -> that name/path (checked FIRST)
 *
 * Our fork's build stamps the channel with the current GIT BRANCH
 * (`script/build.ts` -> OPENCODE_CHANNEL), so every branch silently opened a
 * brand-new EMPTY session store and every conversation from the previous branch
 * became invisible. Measured 2026-08-07 after four branch switches in five days:
 *
 *   opencode.db                                        838 sessions
 *   opencode-mega-run-2026-08-04.db                    376 sessions
 *   opencode-workflow-run-2026-08-06-…-plan-agent.db    19 sessions
 *
 * AJ: "old sessions being hung and inaccessible is an unacceptable result. I
 * often need to continue work in those sessions bc they have all the context
 * already." and "the app … should always launch with my main database bc my
 * testing will include real work, and I dont want to lose it just bc i was on a
 * test build of the app."
 *
 * Nothing was ever deleted — but context you cannot reach is lost work in
 * practice, so this is treated as data integrity, not ergonomics.
 *
 * Sandbox isolation is deliberately NOT provided by this filename:
 * `tools/dev/sandbox.sh` redirects HOME (the engine's data dir derives from it)
 * and additionally names its own store via OPENCODE_DB. So pinning the stable
 * name here cannot leak a smoke run into the live store.
 */

import { describe, it, expect } from 'vitest';

import { pinEngineSessionStore } from '../services/opencode_client_service';

describe('#1332 engine session store is pinned, not branch-scoped', () => {
  it('sets OPENCODE_DISABLE_CHANNEL_DB when nothing chose a store', () => {
    const env: NodeJS.ProcessEnv = {};
    pinEngineSessionStore(env);
    expect(env.OPENCODE_DISABLE_CHANNEL_DB).toBe('1');
  });

  it('is idempotent', () => {
    const env: NodeJS.ProcessEnv = {};
    pinEngineSessionStore(env);
    pinEngineSessionStore(env);
    expect(env.OPENCODE_DISABLE_CHANNEL_DB).toBe('1');
  });

  it('does NOT override an explicit opt-out back to per-branch stores', () => {
    // `0` is falsy to the engine's truthy() flag reader, so this genuinely
    // restores channel-scoped databases for someone who wants them.
    const env: NodeJS.ProcessEnv = { OPENCODE_DISABLE_CHANNEL_DB: '0' };
    pinEngineSessionStore(env);
    expect(env.OPENCODE_DISABLE_CHANNEL_DB).toBe('0');
  });

  it('leaves a sandbox’s explicit OPENCODE_DB untouched', () => {
    // The engine checks OPENCODE_DB before the channel path, so an explicitly
    // named sandbox store wins regardless of this pin. Assert we do not clobber
    // it, and that adding the pin alongside it is harmless.
    const env: NodeJS.ProcessEnv = { OPENCODE_DB: 'opencode-rhythm-sandbox.db' };
    pinEngineSessionStore(env);
    expect(env.OPENCODE_DB).toBe('opencode-rhythm-sandbox.db');
  });

  it('does not touch any other engine env var', () => {
    const env: NodeJS.ProcessEnv = { OPENCODE_DISABLE_EXTERNAL_SKILLS: '1' };
    pinEngineSessionStore(env);
    expect(Object.keys(env).sort()).toEqual([
      'OPENCODE_DISABLE_CHANNEL_DB',
      'OPENCODE_DISABLE_EXTERNAL_SKILLS',
    ]);
  });
});

describe('#1332 the sandbox names its own store explicitly', () => {
  it('sandbox.sh passes OPENCODE_DB into the runtime env', async () => {
    // Isolation must be visible in the sandbox's filename rather than inherited
    // from a channel name it no longer controls.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sh = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'tools', 'dev', 'sandbox.sh'),
      'utf8',
    );
    expect(sh).toContain('OPENCODE_DB=opencode-rhythm-sandbox.db');
    // And it must still isolate via HOME — the primary mechanism.
    expect(sh).toContain('HOME=$SB/home');
  });
});
