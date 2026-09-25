/**
 * #1424 provider-free live matrix: command files reload without an engine
 * restart. Runs only against the isolated tools/dev/sandbox.sh runtime.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:7470';
const SANDBOX_DIR = process.env.RHYTHM_SANDBOX_DIR ?? '';
const COMMAND_NAME = 'live-1424-reload';

function enginePid(): string {
  return readFileSync(join(SANDBOX_DIR, 'opencode_engine.pid'), 'utf8').trim();
}

(RUN ? describe : describe.skip)('#1424 live — command reload', () => {
  let pidBefore: string;

  beforeAll(() => {
    expect(SANDBOX_DIR).not.toBe('');
    expect(isAbsolute(SANDBOX_DIR)).toBe(true);
    expect(new URL(API).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    expect([4000, 4001, 4002, 4096, 4097, 4098, 4099, 5173]).not.toContain(
      Number(new URL(API).port),
    );
    pidBefore = enginePid();
  });

  afterAll(async () => {
    await fetch(`${API}/opencode/commands/${COMMAND_NAME}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  });

  it('1424:mega-1042-provider-free-live-tests:6 exposes a newly written command without restarting the engine', async () => {
    // Regression caught: the route writes commands/*.md but reloadConfig leaves
    // the engine's cached command list stale; list membership fails while the
    // PID equality also guards against a hidden process restart workaround.
    const commandPath = join(
      SANDBOX_DIR,
      'home',
      '.config',
      'opencode',
      'commands',
      `${COMMAND_NAME}.md`,
    );
    expect(existsSync(commandPath)).toBe(false);

    const createResponse = await fetch(`${API}/opencode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: COMMAND_NAME,
        description: 'Synthetic #1424 command reload receipt',
        template: 'Return the literal marker live-1424-command-reloaded.',
      }),
    });
    expect(createResponse.status, await createResponse.text()).toBe(200);
    expect(existsSync(commandPath)).toBe(true);

    const listResponse = await fetch(`${API}/opencode/commands`);
    expect(listResponse.status).toBe(200);
    const commands = (await listResponse.json()) as Array<{
      name?: unknown;
      managed?: unknown;
    }>;
    expect(commands).toContainEqual(
      expect.objectContaining({ name: COMMAND_NAME, managed: true }),
    );
    expect(enginePid()).toBe(pidBefore);
  });
});
