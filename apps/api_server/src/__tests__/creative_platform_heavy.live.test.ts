import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {
  existsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const live =
  process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_CREATIVE_HEAVY_E2E === '1';
const baseUrl = process.env.RHYTHM_LIVE_BASE_URL ?? 'http://127.0.0.1:4098';
const sandboxDir =
  process.env.RHYTHM_SANDBOX_DIR ?? join(tmpdir(), 'rhythm-dev-sandbox');
const creativeRoot = join(
  sandboxDir,
  'home',
  'Library',
  'Application Support',
  'Rhythm',
  'creative-tools',
);
const children = new Set<ChildProcessWithoutNullStreams>();

async function install(
  id: 'blender' | 'comfyui' | 'openmontage',
): Promise<{ status: string; detail: string }> {
  const sessionId = `creative-heavy-${id}-${Date.now()}`;
  const request = () =>
    fetch(`${baseUrl}/creative-platform/${id}/request-or-start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  const first = await request();
  expect(first.status).toBe(202);
  const pending = (await first.json()) as {
    status: string;
    approval: { id: string };
  };
  expect(pending.status).toBe('pending');

  const approval = await fetch(
    `${baseUrl}/agent-approvals/${pending.approval.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        actor: 'creative-platform-heavy-live-test',
      }),
    },
  );
  expect(approval.status).toBe(200);

  const response = await request();
  expect(response.status).toBe(200);
  return (await response.json()) as { status: string; detail: string };
}

async function mcpExchange(
  command: string,
  args: readonly string[],
  requests: readonly Record<string, unknown>[],
  env: NodeJS.ProcessEnv = {},
): Promise<Map<number, Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    let stderr = '';
    const responses = new Map<number, Record<string, unknown>>();
    const expectedIds = requests
      .map((request) => request.id)
      .filter((id): id is number => typeof id === 'number');
    const child = spawn(command, [...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    const finish = (
      result?: Map<number, Record<string, unknown>>,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      children.delete(child);
      child.kill();
      if (error) reject(error);
      else resolve(result!);
    };
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          new Error(
            `MCP exchange timed out for ${command}: ${stderr || output}`,
          ),
        ),
      20_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        const response = JSON.parse(line) as Record<string, unknown>;
        if (typeof response.id === 'number') {
          responses.set(response.id, response);
        }
      }
      if (expectedIds.every((id) => responses.has(id))) finish(responses);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => finish(undefined, error));
    child.once('exit', (code, signal) => {
      if (!settled) {
        finish(
          undefined,
          new Error(
            `MCP server exited early (${signal ?? code}): ${stderr || output}`,
          ),
        );
      }
    });
    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'rhythm-heavy-live-test', version: '1' },
  },
};
const initialized = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
  params: {},
};

async function waitForComfyUi(
  child: ChildProcessWithoutNullStreams,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`ComfyUI exited during startup: ${stderr()}`);
    }
    try {
      const response = await fetch('http://127.0.0.1:8188/system_stats');
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      // The managed runtime is still loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`ComfyUI did not become ready: ${stderr()}`);
}

async function waitForTcp(
  port: number,
  child: ChildProcessWithoutNullStreams,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Process exited before port ${port} opened: ${logs()}`);
    }
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(1_000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Port ${port} did not open: ${logs()}`);
}

afterEach(() => {
  for (const child of children) child.kill();
  children.clear();
});

describe.skipIf(!live)('creative platform heavy sandbox installer', () => {
  it(
    'installs Blender, renders headlessly, and initializes its managed MCP',
    async () => {
      const result = await install('blender');
      expect(result, result.detail).toMatchObject({ status: 'awaiting-user' });
      const root = join(creativeRoot, 'blender');
      const blender = join(
        root,
        'Blender.app',
        'Contents',
        'MacOS',
        'Blender',
      );
      const output = join(sandboxDir, 'blender-smoke.png');
      expect(existsSync(blender)).toBe(true);
      execFileSync(
        blender,
        [
          '--background',
          '--factory-startup',
          '--python-expr',
          [
            'import bpy',
            'scene=bpy.context.scene',
            'scene.render.engine="BLENDER_WORKBENCH"',
            'scene.render.resolution_x=64',
            'scene.render.resolution_y=64',
            'scene.render.resolution_percentage=100',
            `scene.render.filepath=${JSON.stringify(output)}`,
            'bpy.ops.render.render(write_still=True)',
          ].join(';'),
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      expect(statSync(output).size).toBeGreaterThan(100);

      let blenderLogs = '';
      const blenderUi = spawn(
        blender,
        [
          '--factory-startup',
          '--python',
          join(root, 'blender_mcp_addon.py'),
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      children.add(blenderUi);
      blenderUi.stdout.on('data', (chunk: Buffer) => {
        blenderLogs += chunk.toString('utf8');
      });
      blenderUi.stderr.on('data', (chunk: Buffer) => {
        blenderLogs += chunk.toString('utf8');
      });
      await waitForTcp(9876, blenderUi, () => blenderLogs);

      const responses = await mcpExchange(
        join(root, '.venv', 'bin', 'blender-mcp'),
        [],
        [
          initialize,
          initialized,
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'get_scene_info',
              arguments: { user_prompt: 'Rhythm sandbox smoke' },
            },
          },
        ],
        {
          DISABLE_TELEMETRY: 'true',
          BLENDER_HOST: '127.0.0.1',
          BLENDER_PORT: '9876',
        },
      );
      expect(responses.get(1)).toMatchObject({
        result: { serverInfo: expect.objectContaining({ name: expect.any(String) }) },
      });
      expect(responses.get(2)).toMatchObject({
        result: {
          content: [
            expect.objectContaining({ text: expect.stringContaining('Cube') }),
          ],
        },
      });
    },
    600_000,
  );

  it(
    'installs OpenMontage and calls its MCP through managed Python',
    async () => {
      const result = await install('openmontage');
      expect(result, result.detail).toMatchObject({ status: 'installed' });
      const root = join(creativeRoot, 'openmontage');
      const responses = await mcpExchange(
        join(root, '.venv', 'bin', 'python'),
        [join(root, 'openmontage-mcp', 'openmontage_mcp_server.py')],
        [
          initialize,
          initialized,
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'openmontage_status', arguments: {} },
          },
        ],
        { OPENMONTAGE_ROOT: root },
      );
      expect(responses.get(2)).toMatchObject({
        result: {
          tools: [
            expect.objectContaining({ name: 'openmontage_status' }),
          ],
        },
      });
      expect(responses.get(3)).toMatchObject({
        result: {
          content: [
            expect.objectContaining({
              text: expect.stringContaining('installed locally'),
            }),
          ],
        },
      });
    },
    600_000,
  );

  it(
    'installs and starts ComfyUI, then reaches it through the managed MCP',
    async () => {
      const result = await install('comfyui');
      expect(result, result.detail).toMatchObject({ status: 'awaiting-user' });
      const root = join(creativeRoot, 'comfyui');
      let stderr = '';
      const comfy = spawn(
        join(root, '.venv', 'bin', 'python'),
        [
          join(root, 'main.py'),
          '--cpu',
          '--listen',
          '127.0.0.1',
          '--port',
          '8188',
          '--disable-auto-launch',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      children.add(comfy);
      comfy.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      const stats = await waitForComfyUi(comfy, () => stderr);
      expect(stats).toHaveProperty('system');

      const verify = await fetch(
        `${baseUrl}/creative-platform/comfyui/verify`,
        { method: 'POST' },
      );
      expect(verify.status).toBe(200);
      expect((await verify.json()) as { status: string }).toMatchObject({
        status: 'installed',
      });

      const responses = await mcpExchange(
        process.execPath,
        [
          join(
            root,
            'mcp',
            'node_modules',
            '@peleke.s',
            'comfyui-mcp',
            'dist',
            'index.js',
          ),
        ],
        [
          initialize,
          initialized,
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'ping_comfyui', arguments: {} },
          },
        ],
        { COMFYUI_URL: 'http://127.0.0.1:8188' },
      );
      expect(responses.get(2)).toMatchObject({
        result: {
          content: [
            expect.objectContaining({
              text: expect.stringContaining('"reachable": true'),
            }),
          ],
        },
      });
    },
    600_000,
  );
});
