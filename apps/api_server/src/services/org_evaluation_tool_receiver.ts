/** Candidate-only MCP receiver. Every executable byte stays in disposable Docker. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { lstatSync, realpathSync } from 'node:fs';
import { resolveManagedToolArtifactRoot } from '../config/env';
import { inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from './tool_install_artifact';
import { isSafeToolName } from './tool_install_safety';
import { TOOL_TEST_SCENARIOS, isToolTestScenarioId } from './tool_test_scenarios';

export interface ToolReceiverObservation {
  scenarioId: string;
  toolName: string;
  artifactDigest: string;
  changeHash: string;
  outputHash: string;
  receiptHash: string;
  forbiddenArtifactWriteDenied: true;
  containerNetworkMode: 'none';
}

export interface OrgEvaluationToolReceiver {
  baseURL: string;
  port: number;
  token: string;
  observations(): ToolReceiverObservation[];
  close(): Promise<void>;
}

function script(toolName: string, args: readonly string[]): string {
  // Names and scenario args have already passed closed code-owned registries.
  return `set -eu\ncd /tmp\nprintf '{"private":true}' > package.json\nnpm install --offline --ignore-scripts --no-audit --no-fund --omit=dev --omit=optional /artifact.tgz >/dev/null 2>/dev/null\nif (printf x >> /artifact.tgz) 2>/dev/null; then exit 75; fi\nprintf 'NEGATIVE_DENIED\\n'\nnode ./node_modules/.bin/${toolName}${args.length ? ` ${args.join(' ')}` : ''}\n`;
}

async function invokeDocker(input: { artifactPath: string; toolName: string; scenarioId: string }): Promise<{
  output: string; forbiddenArtifactWriteDenied: true;
}> {
  const containerName = `rhythm-eval-tool-${randomBytes(6).toString('hex')}`;
  const args = TOOL_TEST_SCENARIOS[input.scenarioId].args;
  const command = script(input.toolName, args);
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('docker', ['run', '--rm', '--pull', 'never', '--name', containerName,
        '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '128', '--memory', '256m', '--cpus', '1', '--read-only',
        '--tmpfs', '/tmp:rw,size=64m,mode=1777', '--user', 'node',
        '-e', 'HOME=/tmp', '-e', 'npm_config_cache=/tmp/npm-cache',
        '-v', `${input.artifactPath}:/artifact.tgz:ro`, '-w', '/tmp',
        'node:22-alpine', 'sh', '-c', command], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      const collect = (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16_384) { overflow = true; child.kill('SIGKILL'); }
        else chunks.push(chunk);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (overflow || signal || code !== 0) return reject(new Error('Confined tool invocation failed'));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    if (!output.startsWith('NEGATIVE_DENIED\n')) throw new Error('Forbidden artifact write was not denied');
    const result = output.slice('NEGATIVE_DENIED\n'.length);
    if (!result.trim()) throw new Error('Installed tool produced no observed output');
    return { output: result, forbiddenArtifactWriteDenied: true };
  } finally {
    // Exact owned container cleanup, including when docker's client times out.
    spawnSync('docker', ['kill', containerName], { stdio: 'ignore', timeout: 5_000 });
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 5_000 });
  }
}

/** The runtime supplies a frozen candidate and a fresh private parent root. */
export async function startOrgEvaluationToolReceiverAsync(input: {
  changeJson: string;
  workerRoot: string;
  artifactRoot?: string;
  port?: number;
}): Promise<OrgEvaluationToolReceiver> {
  const root = realpathSync(input.workerRoot);
  if (!['/private/tmp/', '/private/var/folders/'].some((prefix) => root.startsWith(prefix)) ||
      !lstatSync(input.workerRoot).isDirectory() ||
      lstatSync(input.workerRoot).isSymbolicLink()) throw new Error('Tool receiver requires an owned temporary evaluation root');
  const change = JSON.parse(input.changeJson) as Record<string, unknown>;
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  const toolName = change.toolName;
  const artifactRoot = input.artifactRoot ?? resolveManagedToolArtifactRoot();
  if (change.installMethod !== 'local-tarball' || typeof toolName !== 'string' || !isSafeToolName(toolName) || !digest ||
      !Array.isArray(change.testPrompts) || change.testPrompts.length < 2 || change.testPrompts.length > 3 ||
      !change.testPrompts.every(isToolTestScenarioId) || new Set(change.testPrompts).size !== change.testPrompts.length) {
    throw new Error('Tool receiver requires a closed immutable candidate');
  }
  const artifact = inspectImmutableLocalTarball(artifactRoot, digest, toolName);
  if (!artifact) throw new Error('Tool receiver lacks its exact pinned tarball');
  const changeHash = createHash('sha256').update(input.changeJson).digest('hex');
  const allowed = new Set(change.testPrompts as string[]);
  const token = randomBytes(32).toString('hex');
  const observations: ToolReceiverObservation[] = [];
  const invoked = new Set<string>();
  let busy = false;
  const server: Server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/invoke' ||
        request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(404).end(); return;
    }
    let bytes = '';
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.toString('utf8');
      if (Buffer.byteLength(bytes) > 4_096) request.destroy();
    });
    request.on('end', () => {
      void (async () => {
        let scenarioId: unknown;
        try { scenarioId = (JSON.parse(bytes) as Record<string, unknown>).scenarioId; } catch { /* refused below */ }
        if (!isToolTestScenarioId(scenarioId) || !allowed.has(scenarioId) || invoked.has(scenarioId) || busy) {
          response.writeHead(400).end(); return;
        }
        busy = true;
        try {
          // Recheck source bytes immediately before every Docker invocation.
          const current = inspectImmutableLocalTarball(artifactRoot, digest, toolName);
          if (!current || current.path !== artifact.path) throw new Error('Pinned artifact changed before invocation');
          const execution = await invokeDocker({ artifactPath: current.path, toolName, scenarioId });
          const outputHash = createHash('sha256').update(execution.output).digest('hex');
          const receiptHash = createHash('sha256').update(JSON.stringify({
            scenarioId, toolName, artifactDigest: digest, changeHash, outputHash,
            forbiddenArtifactWriteDenied: true, containerNetworkMode: 'none',
          })).digest('hex');
          observations.push({ scenarioId, toolName, artifactDigest: digest, changeHash, outputHash, receiptHash,
            forbiddenArtifactWriteDenied: true, containerNetworkMode: 'none' });
          invoked.add(scenarioId);
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            .end(JSON.stringify({ output: execution.output, receiptHash }));
        } catch {
          response.writeHead(503).end(JSON.stringify({ error: 'Confined tool invocation unavailable' }));
        } finally { busy = false; }
      })();
    });
  });
  const port = input.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535 || [4001, 4002, 4096].includes(port))
    throw new Error('Tool receiver port is invalid');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Tool receiver did not bind loopback');
  return { baseURL: `http://127.0.0.1:${address.port}`, port: address.port, token,
    observations: () => observations.map((item) => ({ ...item })),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
