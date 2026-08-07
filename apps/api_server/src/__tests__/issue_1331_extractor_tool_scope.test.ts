/**
 * #1331 — a run whose input is an untrusted transcript must not be able to act.
 *
 * Live incident 2026-08-06: the skill-extract loop was handed a verbatim
 * transcript of a session about debugging a port conflict, and then force-killed
 * the engine on :4096 — quoting "PID 48683", a number that appeared ONLY in the
 * material it was summarising. It was not deciding to manage processes; it was
 * replaying the transcript's task as its own instructions. Every agent session in
 * the app died with it (see #1325).
 *
 * The loop already passed `allowedMcpsJson: '{}'`, which reads like a lockdown but
 * denies MCP tools ONLY — `bash`, `write` and `edit` are engine-NATIVE and stayed
 * reachable. Worse, `run()` sets `permissionMode: 'bypassPermissions'`, so nothing
 * gated them.
 *
 * The fix is `denyAllTools`, forwarded as the engine's per-prompt `tools` map. The
 * fork turns `{'*': false}` into `{permission:'*', action:'deny', pattern:'*'}`
 * (session/prompt.ts), and `evaluate()` wildcard-matches the rule's permission
 * field — so every tool name is denied by the ENGINE. A deny is refused there and
 * never surfaces as `permission.asked`, so Rhythm's bridge cannot auto-approve it.
 * Note `permissionMode`/`bypassPermissions` appear nowhere in the fork — they are
 * Rhythm-side concepts — so they cannot soften an engine deny.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateSession, mockPrompt, mockAbortSession, mockListMcp } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
  mockListMcp: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
    listMcp: mockListMcp,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

/** promptOpts is the 5th positional arg of opencodeClient.prompt. */
function lastPromptOpts(): Record<string, unknown> {
  const call = mockPrompt.mock.calls.at(-1);
  return (call?.[4] ?? {}) as Record<string, unknown>;
}

describe('#1331 denyAllTools — engine-enforced tool lockdown', () => {
  beforeEach(() => {
    // #1222 changed createSession's contract to `{id} | {error}`; a bare string
    // makes run() fail before it ever prompts ("Cannot use 'in' operator …").
    mockCreateSession.mockReset().mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockReset().mockResolvedValue('ok');
    mockAbortSession.mockReset();
    mockListMcp.mockReset().mockResolvedValue([]);
  });

  it('forwards tools:{"*":false} when denyAllTools is set', async () => {
    await run({ prompt: 'distill this transcript', denyAllTools: true });
    expect(lastPromptOpts().tools).toEqual({ '*': false });
  });

  it('omits the tools key entirely when denyAllTools is NOT set', async () => {
    // Every other caller must keep its current behaviour — an empty/absent map
    // means "do not touch the session ruleset", and the engine only replaces the
    // ruleset when the map is non-empty.
    await run({ prompt: 'ordinary run' });
    expect(lastPromptOpts()).not.toHaveProperty('tools');
  });

  it('omits the tools key when denyAllTools is explicitly false', async () => {
    await run({ prompt: 'ordinary run', denyAllTools: false });
    expect(lastPromptOpts()).not.toHaveProperty('tools');
  });

  it('the deny does not disturb the rest of promptOpts', async () => {
    await run({ prompt: 'distill', denyAllTools: true });
    const opts = lastPromptOpts();
    // bypassPermissions is still sent (it is Rhythm-side and harmless), and the
    // deny sits alongside it rather than replacing anything.
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.tools).toEqual({ '*': false });
  });

  it('denies with a wildcard rather than a hand-maintained tool list', async () => {
    // A list would need updating every time the engine gains a tool. The wildcard
    // is fail-closed: a future tool is denied without anyone remembering.
    await run({ prompt: 'distill', denyAllTools: true });
    const tools = lastPromptOpts().tools as Record<string, boolean>;
    expect(Object.keys(tools)).toEqual(['*']);
    expect(Object.values(tools).every((v) => v === false)).toBe(true);
  });
});

describe('#1331 the skill extractor uses it', () => {
  it('defaultLlmCall denies all tools', async () => {
    // The extractor builds its own run() options. Assert the real call site sets
    // the flag — the mechanism above is useless if the motivating caller forgets.
    // `import.meta.url` does not compile under this package's tsconfig module
    // setting; resolve from __dirname instead.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '..', 'services', 'skill_extractor.ts'),
      'utf8',
    );
    // Locate the defaultLlmCall run({...}) block and assert the flag is inside it.
    const start = src.indexOf('const defaultLlmCall');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('};', start));
    expect(block).toContain("mcpRole: 'skill-extract'");
    expect(block).toContain('denyAllTools: true');
  });
});
