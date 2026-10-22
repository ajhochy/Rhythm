/** Parent-owned narrow receiver process opening only copied SQLite state. */
import Database from 'better-sqlite3';
import { lstatSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setDb } from '../database/db';
import { createIsolatedTrustedMcpVerifier } from '../security/trusted_mcp_call';
import { inspectActivatedManagedToolAsync } from './tool_install_apply';
import { ManagedToolsService } from './managed_tools_service';
import { startPrivateManagedToolReceiverAsync } from './org_evaluation_managed_receiver';
import { attestPrivateEngineListener } from './org_evaluation_managed_engine_owner';

interface Boot {
  workerRoot: string; dbPath: string; managedRoot: string; workspacePath: string;
  enginePort: number; ownerUserId: number; token: string;
  pinnedBinary: string; binarySha256: string;
}

function inside(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return !!suffix && suffix !== '..' && !suffix.startsWith('../');
}

function validBoot(value: unknown): Boot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid private bridge boot');
  const boot = value as Boot;
  const root = realpathSync(boot.workerRoot);
  if (!root.startsWith('/private/tmp/') || !lstatSync(boot.workerRoot).isDirectory() ||
      !lstatSync(boot.dbPath).isFile() ||
      !lstatSync(boot.managedRoot).isDirectory() ||
      !lstatSync(boot.workspacePath).isDirectory() ||
      !inside(root, resolve(boot.dbPath)) ||
      !inside(root, resolve(boot.managedRoot)) || !inside(root, resolve(boot.workspacePath)) ||
      !inside(root, realpathSync(boot.dbPath)) ||
      !inside(root, realpathSync(boot.managedRoot)) ||
      !inside(root, realpathSync(boot.workspacePath)) ||
      boot.pinnedBinary !== resolve(root, 'opencode') ||
      !lstatSync(boot.pinnedBinary).isFile() ||
      realpathSync(boot.pinnedBinary) !== boot.pinnedBinary ||
      !/^[a-f0-9]{64}$/.test(boot.binarySha256) ||
      !Number.isInteger(boot.enginePort) || boot.enginePort < 1024 ||
      [4000, 4001, 4002, 4096, 4098].includes(boot.enginePort) ||
      !Number.isSafeInteger(boot.ownerUserId) || boot.ownerUserId < 1 ||
      typeof boot.token !== 'string' || boot.token.length < 32) throw Error('Invalid private bridge boot');
  return boot;
}

async function ownedEngineJson(port: number, path: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) return null;
  return response.json();
}

/** The parent holds this process PID; it must kill/reap the process before
 * deleting workerRoot. Never import this into the live API process. */
export async function servePrivateManagedBridgeAsync(value: unknown,
  boundWorkerPid: () => number | null): Promise<void> {
  const boot = validBoot(value);
  const db = new Database(boot.dbPath);
  db.pragma('foreign_keys = ON');
  const previous = setDb(db);
  let verifier: ReturnType<typeof createIsolatedTrustedMcpVerifier> | null = null;
  let pinnedKeyId: string | null = null;
  let listenerIdentity: string | null = null;
  const attest = () => {
    const workerPid = boundWorkerPid();
    if (!workerPid) throw Error('Private worker PID was not bound');
    const observed = attestPrivateEngineListener({ enginePort: boot.enginePort,
      workerPid, pinnedBinary: boot.pinnedBinary, binarySha256: boot.binarySha256 });
    const identity = `${observed.enginePid}:${observed.engineStart}:${observed.workerStart}`;
    if (listenerIdentity && listenerIdentity !== identity)
      throw Error('Private engine listener identity changed');
    listenerIdentity = identity;
  };
  const scopedVerifier = {
    async verify(call: unknown, expectedToolName: string, now?: number, nonceScope?: string) {
      attest();
      if (!verifier) {
        const document = await ownedEngineJson(boot.enginePort, '/global/rhythm/security-key');
        if (!document || typeof document !== 'object' || Array.isArray(document) ||
            typeof (document as { keyId?: unknown }).keyId !== 'string') throw Error('Engine key unavailable');
        verifier = createIsolatedTrustedMcpVerifier(document);
        pinnedKeyId = (document as { keyId: string }).keyId;
      }
      // Reject any private engine restart/key rotation during one candidate arm.
      const current = await ownedEngineJson(boot.enginePort, '/global/rhythm/security-key');
      attest();
      if (!current || typeof current !== 'object' || Array.isArray(current) ||
          (current as { keyId?: unknown }).keyId !== pinnedKeyId) throw Error('Private engine key changed');
      return verifier.verify(call, expectedToolName, now ?? Date.now(), nonceScope ?? expectedToolName);
    },
    dispose() { verifier?.dispose(); verifier = null; pinnedKeyId = null; },
  };
  const active = async (sdkSessionId: string, turnId: string, toolCallId: string, cwd: string) => {
    if (cwd !== boot.workspacePath) return null;
    attest();
    const query = `?directory=${encodeURIComponent(boot.workspacePath)}`;
    const value = await ownedEngineJson(boot.enginePort,
      `/session/${encodeURIComponent(sdkSessionId)}/rhythm-active-tool/${encodeURIComponent(turnId)}/${encodeURIComponent(toolCallId)}${query}`);
    attest();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = ['sdkSessionId', 'assistantId', 'userMessageId', 'partId', 'toolCallId',
      'toolKey', 'agentName', 'serverName', 'toolName'];
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length ||
        keys.some((key) => typeof record[key] !== 'string' || !(record[key] as string).length ||
          (record[key] as string).length > 256)) return null;
    return record as any;
  };
  const service = new ManagedToolsService({ active,
    inspect: (proposal, profileId) => inspectActivatedManagedToolAsync(proposal, profileId,
      { managedRoot: boot.managedRoot }),
  });
  const expectedSessionId = () => {
    const rows = db.prepare('SELECT sdk_session_id FROM agent_sessions WHERE owner_user_id = ? AND status IN (?, ?) AND sdk_session_id IS NOT NULL')
      .all(boot.ownerUserId, 'working', 'idle') as Array<{ sdk_session_id: string }>;
    return rows.length === 1 ? rows[0].sdk_session_id : null;
  };
  try {
    const receiver = await startPrivateManagedToolReceiverAsync({ token: boot.token,
      ownerUserId: boot.ownerUserId, expectedSessionId, verifier: scopedVerifier, service });
    process.stdout.write(JSON.stringify({ ready: true, port: receiver.port }) + '\n');
    await new Promise<void>((resolveClose) => {
      process.once('SIGTERM', resolveClose); process.once('SIGINT', resolveClose);
      process.stdin.once('end', resolveClose);
    });
    process.stdout.write(JSON.stringify({ observations: receiver.observations() }) + '\n');
    await receiver.close();
  } finally {
    scopedVerifier.dispose(); setDb(previous); db.close();
  }
}

if (require.main === module) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let workerPid: number | null = null;
  let started = false;
  lines.once('line', (raw) => {
    if (Buffer.byteLength(raw) > 4096) { process.exitCode = 2; return; }
    try {
      started = true;
      void servePrivateManagedBridgeAsync(JSON.parse(raw), () => workerPid)
        .catch(() => { process.exitCode = 2; });
      lines.on('line', (binding) => {
        if (!started || workerPid !== null || Buffer.byteLength(binding) > 128)
          { process.exitCode = 2; return; }
        try {
          const value = JSON.parse(binding) as { bindWorkerPid?: unknown };
          if (Object.keys(value).length !== 1 || !Number.isSafeInteger(value.bindWorkerPid) ||
              (value.bindWorkerPid as number) <= 1) throw Error('Invalid worker binding');
          workerPid = value.bindWorkerPid as number;
          process.stdout.write(JSON.stringify({ bound: true }) + '\n');
        } catch { process.exitCode = 2; }
      });
    }
    catch { process.exitCode = 2; }
  });
}
