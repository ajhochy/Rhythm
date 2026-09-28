/** #1568: HTTP envelope with disposable sandbox-only credentials; NEVER a real ChatGPT request. */
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;

live('issue-1568-c6: real HTTP credential-state failures', () => {
  it('never publishes quota or credential material for absent, expired and malformed synthetic auth', async () => {
    const port = process.env.RHYTHM_SANDBOX_API_PORT;
    const sandbox = process.env.RHYTHM_SANDBOX_DIR;
    if (process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' || port !== '6098' || !sandbox?.startsWith('/private/tmp/rhythm-swarm-1568-')) throw new Error('Requires dedicated #1568 sandbox');
    const authPath = join(sandbox, 'home/.local/share/opencode/auth.json');
    if (existsSync(authPath)) throw new Error('Sandbox must start without auth.json');
    const url = `http://127.0.0.1:${port}/agents/usage-budget?force=true`;
    async function check() {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const json = await response.json() as { providers: Array<{ provider: string; kind: string; items: unknown[]; reason?: string }>; fetchedAt: string };
      expect(Date.parse(json.fetchedAt)).not.toBeNaN();
      expect(json.providers.map((p) => p.provider)).toEqual(['anthropic', 'openrouter', 'gemini', 'openai']);
      const openai = json.providers[3];
      expect(openai).toMatchObject({ provider: 'openai', kind: 'unavailable', items: [] });
      expect(openai.reason).toEqual(expect.any(String));
      expect(JSON.stringify(json)).not.toContain('SECRET-SYNTHETIC-1568');
    }
    await check();
    try {
      writeFileSync(authPath, JSON.stringify({ openai: { type: 'oauth', access: 'SECRET-SYNTHETIC-1568', expires: 1 } }), { flag: 'wx', mode: 0o600 });
      await check();
      writeFileSync(authPath, '{');
      await check();
    } finally {
      if (existsSync(authPath)) unlinkSync(authPath);
    }
  }, 60_000);
});
