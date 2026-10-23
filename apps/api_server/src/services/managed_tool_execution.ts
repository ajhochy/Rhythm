/** Approved local tools run offline in disposable Docker, never on the host. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ActivatedManagedTool } from './tool_install_apply';
import { validateImmutableLocalTarballBytes } from './tool_install_artifact';
import { isSafeToolName } from './tool_install_safety';

export interface ManagedToolArguments { argv: string[]; stdin: string }
export interface ManagedToolExecutionResult {
  output: string;
  outputHash: string;
  artifactDigest: string;
  networkMode: 'none';
  forbiddenArtifactWriteDenied: true;
}

export function validateManagedToolArguments(value: unknown): ManagedToolArguments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments');
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some(key => !['argv', 'stdin'].includes(key)) ||
      !Array.isArray(args.argv) || args.argv.length > 32 ||
      !args.argv.every(arg => typeof arg === 'string' && !arg.includes('\0') && Buffer.byteLength(arg) <= 2_048) ||
      Buffer.byteLength(JSON.stringify(args.argv)) > 8_192 ||
      args.stdin !== undefined && (typeof args.stdin !== 'string' || Buffer.byteLength(args.stdin) > 32_768))
    throw new Error('Invalid tool arguments');
  return { argv: [...args.argv] as string[], stdin: args.stdin as string | undefined ?? '' };
}

/** A fixed Node program starts the approved bin with literal argv. The input
 * is JSON data sent through stdin; neither argv nor stdin is shell source. */
const CONTAINER_PROGRAM = `
const fs=require('fs'),cp=require('child_process');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
try { fs.appendFileSync('/artifact.tgz','x'); process.exit(75); } catch {}
const installed=cp.spawnSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--omit=optional','/artifact.tgz'],{cwd:'/tmp',encoding:'utf8',timeout:20000,maxBuffer:16384});
if(installed.status!==0)process.exit(76);
const child=cp.spawnSync(process.execPath,['/tmp/node_modules/.bin/'+input.toolName,...input.argv],{input:input.stdin,encoding:'utf8',cwd:'/tmp',timeout:20000,maxBuffer:16384,env:{PATH:process.env.PATH,HOME:'/tmp'}});
if(child.error||child.signal||child.status!==0)process.exit(77);
process.stdout.write(JSON.stringify({denied:true,output:child.stdout,stderr:child.stderr}));
`;

export async function invokeManagedToolDockerAsync(tool: ActivatedManagedTool,
  rawArguments: unknown): Promise<ManagedToolExecutionResult> {
  const args = validateManagedToolArguments(rawArguments);
  if (!isSafeToolName(tool.toolName) || !/^[a-f0-9]{64}$/.test(tool.artifactDigest)) throw new Error('Invalid approved tool');
  const scratch = mkdtempSync(join(tmpdir(), 'rhythm-managed-tool-run-'));
  const archive = join(scratch, 'artifact.tgz');
  const container = `rhythm-managed-tool-${randomBytes(8).toString('hex')}`;
  try {
    copyFileSync(tool.artifactPath, archive);
    // Validate the exact private copy that will be mounted. Later changes to
    // the host install cannot change the executing archive underneath Docker.
    if (!validateImmutableLocalTarballBytes(readFileSync(archive), tool.artifactDigest, tool.toolName))
      throw new Error('Approved tool bytes changed');
    chmodSync(archive, 0o444);
    const bytes = await new Promise<string>((resolveRun, reject) => {
      const child = spawn('docker', ['run', '--rm', '-i', '--pull', 'never', '--name', container,
        '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '128', '--memory', '256m', '--cpus', '1', '--read-only',
        '--tmpfs', '/tmp:rw,size=64m,mode=1777', '--user', 'node',
        '-e', 'HOME=/tmp', '-e', 'npm_config_cache=/tmp/npm-cache',
        '-v', `${archive}:/artifact.tgz:ro`, '-w', '/tmp',
        'node:22-alpine', 'node', '-e', CONTAINER_PROGRAM], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const output: Buffer[] = []; let size = 0; let invalid = false;
      const collect = (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32_768) { invalid = true; child.kill('SIGKILL'); }
        else output.push(chunk);
      };
      child.stdout.on('data', collect);
      // Do not expose Docker diagnostics containing local paths to the model.
      child.stderr.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 32_768) { invalid = true; child.kill('SIGKILL'); } });
      child.stdin.on('error', () => { /* close/error below owns rejection */ });
      const timeout = setTimeout(() => { invalid = true; child.kill('SIGKILL'); }, 45_000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Confined tool execution unavailable')); });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        if (invalid || code !== 0 || signal) reject(new Error(`Confined tool execution failed (${code === 75 ? 'write guard' : code === 76 ? 'offline install' : code === 77 ? 'command' : 'container'})`));
        else resolveRun(Buffer.concat(output).toString('utf8'));
      });
      child.stdin.end(JSON.stringify({ toolName: tool.toolName, ...args }));
    });
    const result = JSON.parse(bytes) as Record<string, unknown>;
    if (result.denied !== true || typeof result.output !== 'string' || typeof result.stderr !== 'string')
      throw new Error('Invalid confined tool result');
    const output = result.output + result.stderr;
    if (Buffer.byteLength(output) > 16_384) throw new Error('Confined tool output exceeded limit');
    return { output, outputHash: createHash('sha256').update(output).digest('hex'),
      artifactDigest: tool.artifactDigest, networkMode: 'none', forbiddenArtifactWriteDenied: true };
  } finally {
    spawnSync('docker', ['kill', container], { stdio: 'ignore', timeout: 5_000 });
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 5_000 });
    rmSync(scratch, { recursive: true, force: true });
  }
}
