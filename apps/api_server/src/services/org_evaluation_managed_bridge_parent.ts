/** Parent-owned separate receiver process for one candidate arm. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface PrivateManagedBridge {
  baseURL: string; port: number; token: string;
  bindWorker(pid: number): Promise<void>;
  close(): Promise<Array<Record<string, unknown>>>;
}

function under(root: string, value: string): boolean {
  const path = relative(root, value);
  return !!path && path !== '..' && !path.startsWith('../');
}

/** Start only after prepareEvaluationWorkerFilesystem copied the DB. The
 * engine itself boots later inside sandbox-exec, so the child pins its key on
 * the first signed tool call. Parent must keep this child alive through run. */
export async function startPrivateManagedBridgeAsync(input: {
  workerRoot: string; dbPath: string; workspacePath: string;
  enginePort: number; ownerUserId: number; pinnedBinary: string;
}): Promise<PrivateManagedBridge> {
  const root = realpathSync(input.workerRoot);
  const managedRoot = join(root, 'managed-tools');
  if (!root.startsWith('/private/tmp/') || !lstatSync(input.workerRoot).isDirectory() ||
      !under(root, resolve(input.dbPath)) ||
      !under(root, resolve(input.workspacePath)) || !existsSync(input.dbPath) ||
      !lstatSync(input.dbPath).isFile() || !lstatSync(input.workspacePath).isDirectory() ||
      !under(root, realpathSync(input.dbPath)) ||
      !under(root, realpathSync(input.workspacePath)) ||
      !Number.isSafeInteger(input.ownerUserId) || input.ownerUserId < 1) {
    throw Error('Private managed bridge requires copied owned state');
  }
  mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
  if (!lstatSync(managedRoot).isDirectory() || !under(root, realpathSync(managedRoot)))
    throw Error('Private managed root is not owned');
  if (input.pinnedBinary !== join(root, 'opencode') ||
      !lstatSync(input.pinnedBinary).isFile() ||
      realpathSync(input.pinnedBinary) !== input.pinnedBinary)
    throw Error('Private managed bridge engine binary is not pinned');
  const binarySha256 = createHash('sha256').update(readFileSync(input.pinnedBinary)).digest('hex');
  const token = randomBytes(32).toString('hex');
  const modulePath = join(__dirname, 'org_evaluation_managed_bridge_process.js');
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [modulePath], {
    cwd: root, detached: true,
    env: { PATH: process.env.PATH, HOME: root, TMPDIR: join(root, 'tmp'),
      DB_CLIENT: 'sqlite', DB_PATH: input.dbPath,
      RHYTHM_TOOL_ARTIFACT_ROOT: join(root, 'artifacts'),
      RHYTHM_MANAGED_TOOL_ROOT: managedRoot,
      RHYTHM_MANAGED_CONTEXT_EXPORTS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let observations: Array<Record<string, unknown>> | null = null;
  let closed = false;
  let bound = false;
  let binding: { resolve(): void; reject(error: Error): void } | null = null;
  const closedPromise = new Promise<void>((done) => child.once('close', () => {
    closed = true; done();
  }));
  const ready = new Promise<number>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(Error('Private managed bridge did not start')), 8000);
    const fail = (error: Error) => { clearTimeout(timeout); rejectReady(error); };
    child.once('error', fail);
    child.once('exit', (code) => fail(Error(`Private managed bridge exited ${code}`)));
    child.stdout.on('data', (bytes: Buffer) => {
      buffer += bytes.toString('utf8');
      if (buffer.length > 65_536) { fail(Error('Private managed bridge emitted oversized receipt')); return; }
      while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        const parsed = JSON.parse(line) as { ready?: unknown; bound?: unknown; port?: unknown;
          observations?: unknown };
        if (Array.isArray(parsed.observations)) {
          if (parsed.observations.length > 64 || parsed.observations.some((value) =>
              !value || typeof value !== 'object' || Array.isArray(value)))
            throw Error('Private managed receipt malformed');
          observations = parsed.observations as Array<Record<string, unknown>>;
          continue;
        }
        if (parsed.bound === true && binding) {
          bound = true; binding.resolve(); binding = null; continue;
        }
        if (parsed.ready !== true || !Number.isInteger(parsed.port) ||
            (parsed.port as number) < 1024 || (parsed.port as number) > 65535 ||
            [4000, 4001, 4002, 4096, 4098, input.enginePort].includes(parsed.port as number))
          throw Error('Private managed bridge startup was malformed');
        clearTimeout(timeout); resolveReady(parsed.port as number);
      } catch (error) { fail(error as Error); }
      }
    });
  });
  child.stdin.write(JSON.stringify({ ...input, workerRoot: root, managedRoot,
    binarySha256, token }) + '\n');
  let port: number;
  try { port = await ready; }
  catch (error) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
    throw error;
  }
  return { baseURL: `http://127.0.0.1:${port}`, port, token,
    bindWorker: async (pid) => {
      if (bound || binding || closed || !Number.isSafeInteger(pid) || pid <= 1)
        throw Error('Private worker binding is invalid');
      try { await new Promise<void>((resolveBound, rejectBound) => {
        const timeout = setTimeout(() => rejectBound(Error('Private worker binding timed out')), 5000);
        binding = {
          resolve: () => { clearTimeout(timeout); resolveBound(); },
          reject: error => { clearTimeout(timeout); rejectBound(error); },
        };
        child.stdin.write(JSON.stringify({ bindWorkerPid: pid }) + '\n');
      }); } catch (error) {
        if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
        await closedPromise;
        throw error;
      }
    },
    close: async () => {
      if (!closed) child.stdin.end();
      await Promise.race([
        closedPromise,
        new Promise<void>((done) => setTimeout(done, 2000)),
      ]);
      if (!closed && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
        await closedPromise;
      }
      if (!observations) throw Error('Private managed bridge did not return an observation ledger');
      return observations;
    },
  };
}
