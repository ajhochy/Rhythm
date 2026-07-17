/**
 * #1069 (OCU-28) — rhythm-telemetry plugin tests.
 *
 * Two layers, matching the anthropic_plugin_routing.test.ts convention of
 * importing the REAL vendored plugin module (no SDK-shape mocks):
 *  1. Plugin hook payload -> POST shape (real plugin module, a local
 *     node:http stub server plays api_server's ingestion endpoint).
 *  2. `ensureRequiredPlugins` entry management for the telemetry plugin path
 *     (add/remove based on RHYTHM_TOOL_TELEMETRY_DISABLED), preserving the
 *     existing anthropic + required-plugin entries untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureRequiredPlugins,
  rhythmAnthropicPluginPath,
  rhythmTelemetryPluginPath,
} from '../services/opencode_plugin_config';

const PLUGIN_DIR = join(__dirname, '..', '..', 'opencode_plugins', 'rhythm-telemetry');
const PLUGIN_INDEX = join(PLUGIN_DIR, 'index.js');

// ---------------------------------------------------------------------------
// Layer 1 — real plugin module, stubbed ingestion endpoint
// ---------------------------------------------------------------------------

describe('rhythm-telemetry plugin — tool.execute.before/after -> POST shape', () => {
  let stub: Server;
  let stubUrl: string;
  let receivedBodies: Array<Record<string, unknown>> = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    stub = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        try {
          receivedBodies.push(JSON.parse(raw));
        } catch {
          /* ignore parse errors in the test stub */
        }
        res.writeHead(202);
        res.end();
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    stub.close();
  });

  beforeEach(() => {
    receivedBodies = [];
    process.env.RHYTHM_API_BASE = stubUrl;
    delete process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadPlugin() {
    // Cache-bust so each test gets a fresh module (fresh `starts` Map) and
    // picks up the just-set RHYTHM_API_BASE — matches the anthropic plugin
    // test file's `vi.resetModules()` posture, applied via a query-string
    // cache-buster since this is a plain dynamic import, not a vi mock.
    const mod = await import(`${PLUGIN_INDEX}?t=${Date.now()}-${Math.random()}`);
    return mod.default;
  }

  it('exists at the expected vendored path', () => {
    expect(existsSync(PLUGIN_INDEX)).toBe(true);
  });

  it('POSTs a tool-event with tool/session/callID/duration/status after a completed call', async () => {
    const plugin = await loadPlugin();
    const hooks = await plugin();
    await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'sess-1', callID: 'call-1' }, {});
    await new Promise((r) => setTimeout(r, 20)); // ensure measurable duration
    await hooks['tool.execute.after'](
      { tool: 'bash', sessionID: 'sess-1', callID: 'call-1', args: {} },
      { title: 'bash', output: 'ok', metadata: {} },
    );

    await new Promise((r) => setTimeout(r, 50)); // let the fire-and-forget POST land
    expect(receivedBodies).toHaveLength(1);
    const body = receivedBodies[0];
    expect(body.sessionID).toBe('sess-1');
    expect(body.callID).toBe('call-1');
    expect(body.tool).toBe('bash');
    expect(body.status).toBe('success');
    expect(typeof body.durationMs).toBe('number');
    expect(body.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('never blocks tool.execute.after — the hook returns before the network round-trip completes', async () => {
    const plugin = await loadPlugin();
    const hooks = await plugin();
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'sess-2', callID: 'call-2' }, {});
    const start = Date.now();
    await hooks['tool.execute.after'](
      { tool: 'read', sessionID: 'sess-2', callID: 'call-2', args: {} },
      { title: 'read', output: 'ok', metadata: {} },
    );
    // The hook itself must return near-instantly (no awaited fetch).
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('RHYTHM_TOOL_TELEMETRY_DISABLED=1 registers no hooks at all', async () => {
    process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = '1';
    const plugin = await loadPlugin();
    const hooks = await plugin();
    expect(hooks).toEqual({});
  });

  it('plugin absence/failure is tolerated — a missing sessionID/callID never throws synchronously', async () => {
    const plugin = await loadPlugin();
    const hooks = await plugin();
    await expect(hooks['tool.execute.after']({ tool: 'x' }, {})).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — ensureRequiredPlugins entry management for the telemetry path
// ---------------------------------------------------------------------------

describe('ensureRequiredPlugins — rhythm-telemetry entry management', () => {
  let configPath = '';
  const originalDisabled = process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;

  beforeEach(() => {
    configPath = join(mkdtempSync(join(tmpdir(), 'oc-config-telemetry-')), 'opencode.json');
    delete process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    if (originalDisabled === undefined) delete process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;
    else process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = originalDisabled;
  });

  it('resolves the vendored telemetry plugin dir by default', () => {
    expect(rhythmTelemetryPluginPath()).toBe(PLUGIN_DIR);
  });

  it('returns null when the disable flag is set', () => {
    process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = '1';
    expect(rhythmTelemetryPluginPath()).toBeNull();
  });

  it('adds the telemetry plugin entry alongside the anthropic + required entries', () => {
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { plugin: string[] };
    expect(parsed.plugin).toContain(PLUGIN_DIR);
    expect(parsed.plugin).toContain(rhythmAnthropicPluginPath());
    expect(parsed.plugin).toContain('opencode-openai-codex-auth');
    expect(parsed.plugin).toContain('opencode-gemini-auth');
  });

  it('removes a stale telemetry entry once the disable flag is set', () => {
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    let parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { plugin: string[] };
    expect(parsed.plugin).toContain(PLUGIN_DIR);

    process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = '1';
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { plugin: string[] };
    expect(parsed.plugin).not.toContain(PLUGIN_DIR);
    // The anthropic plugin entry must survive untouched.
    expect(parsed.plugin).toContain(rhythmAnthropicPluginPath());
  });

  it('is idempotent with telemetry enabled', () => {
    expect(ensureRequiredPlugins(configPath)).toBe(true);
    expect(ensureRequiredPlugins(configPath)).toBe(false);
  });
});
