/**
 * The parent API may admit an evaluation, but only a disposable worker may
 * materialize a candidate or run its task. This module is deliberately free
 * of live repositories and the shared OpenCode singleton.
 */
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import { requiredEffectEvidence, verifyObservedEffects } from '../models/org_evaluation_effect_evidence';
export { requiredEffectEvidence, verifyObservedEffects } from '../models/org_evaluation_effect_evidence';
import type { OrgEvaluationStage, OrgEvaluationTokenUsage } from '../models/org_evaluation';
import type { OrgEvaluationRuntimePort } from './org_evaluation_coordinator';
import { prepareOrgEvaluationFixture } from './org_evaluation_fixture';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { publicationReceiverInput } from './org_evaluation_publication_state';
import { startOrgEvaluationPublishReceiverAsync } from './org_evaluation_publish_receiver';
import { verifyScopeDelegationEffects } from './org_evaluation_scope_effects';
import { unpublishedOrgSkillEvent } from './org_evaluation_skill_absence';
import { externalSkillReceiverInput, startExternalSkillReceiverAsync } from './org_evaluation_external_source';
import type {
  EvaluationExecuteRequest,
  EvaluationMaterializeRequest,
  EvaluationMaterializedConfiguration,
  EvaluationWorkerExecution,
} from './org_evaluation_worker';

export interface EvaluationWorkerInput {
  candidateId: string;
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  fixtureRoot: string;
  fixtureDb: string;
  fixtureConfig: string;
  workerRoot: string;
  enginePort: number;
  webhookPort?: number;
  publicationBaseURL?: string;
  publicationToken?: string;
  externalSource?: { url: string; sha256: string; receiverURL: string; token: string };
  /** A request-scoped local relay which admits each provider request. */
  providerRelayUrl: string;
}

function isUnder(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
}

function temporaryPath(path: string): boolean {
  const normalized = resolve(path);
  return isAbsolute(path) &&
    (isUnder('/private/tmp', normalized) || isUnder('/tmp', normalized) || isUnder('/var/folders', normalized));
}

/** Reject unsafe inputs before spawning anything. The worker rechecks real paths and file modes. */
export function assertEvaluationWorkerInput(input: EvaluationWorkerInput): void {
  if (!input.candidateId || !input.targetRef || !temporaryPath(input.fixtureRoot) ||
      !temporaryPath(input.workerRoot) ||
      !isUnder(resolve(input.fixtureRoot), resolve(input.fixtureDb)) ||
      !isUnder(resolve(input.fixtureRoot), resolve(input.fixtureConfig)) ||
      isUnder(resolve(input.workerRoot), resolve(input.fixtureRoot)) ||
      isUnder(resolve(input.fixtureRoot), resolve(input.workerRoot))) {
    throw new Error('Evaluation fixture and worker paths must be distinct temporary roots');
  }
  if (!Number.isInteger(input.enginePort) || input.enginePort < 1024 || input.enginePort > 65535 ||
      [4001, 4002, 4096].includes(input.enginePort)) {
    throw new Error('Evaluation engine port is invalid or reserved');
  }
  if (input.webhookPort !== undefined && (!Number.isInteger(input.webhookPort) ||
      input.webhookPort < 60001 || input.webhookPort > 63999 || input.webhookPort === input.enginePort)) {
    throw new Error('Evaluation webhook port is invalid or reserved');
  }
  if (input.publicationBaseURL) {
    const publication = new URL(input.publicationBaseURL);
    if (publication.protocol !== 'http:' || publication.hostname !== '127.0.0.1' ||
        !publication.port || publication.pathname !== '/' || publication.search || publication.hash ||
        !input.publicationToken || input.publicationToken.length < 32 ||
        Number(publication.port) === input.enginePort ||
        Number(publication.port) === input.webhookPort ||
        [4000, 4001, 4002, 4096, 4098].includes(Number(publication.port))) {
      throw new Error('Evaluation publication receiver is not privately bound');
    }
  }
  if (input.externalSource) {
    const external = new URL(input.externalSource.receiverURL);
    if (external.protocol !== 'http:' || external.hostname !== '127.0.0.1' ||
        !external.port || external.pathname !== '/' || external.search || external.hash ||
        input.externalSource.token.length < 32 ||
        !/^[a-f0-9]{64}$/.test(input.externalSource.sha256) ||
        Number(external.port) === input.enginePort ||
        [4000, 4001, 4002, 4096, 4098].includes(Number(external.port))) {
      throw new Error('Evaluation external source receiver is not privately bound');
    }
  }
  let relay: URL;
  try { relay = new URL(input.providerRelayUrl); }
  catch { throw new Error('Evaluation provider relay URL is invalid'); }
  if (relay.protocol !== 'http:' || relay.hostname !== '127.0.0.1' || !relay.port ||
      relay.username || relay.password ||
      !/^\/agent-org-proposals\/evaluations\/provider\/[A-Za-z0-9_-]+\/v1$/.test(relay.pathname) ||
      relay.search || relay.hash || Number(relay.port) === input.enginePort ||
      Number(relay.port) === input.webhookPort ||
      [4000, 4001, 4002, 4096, 4098].includes(Number(relay.port))) {
    throw new Error('Evaluation provider relay must be a distinct local endpoint');
  }
}

function inspectFixtureTree(path: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
    throw new Error('Evaluation fixture contains a symlink or unsupported file');
  }
  if (entry.isDirectory()) {
    for (const child of readdirSync(path)) inspectFixtureTree(join(path, child));
  } else if (entry.mode & 0o222) {
    throw new Error('Evaluation fixture input must be read-only');
  }
}

export interface PreparedEvaluationWorkerFilesystem {
  homePath: string;
  dbPath: string;
  configPath: string;
  workspacePath: string;
}

/**
 * The child gets a private copy of a sanitized fixture. Its writable state is
 * never shared with another arm or the parent API. The engine starts only
 * after this function returns successfully.
 */
export function prepareEvaluationWorkerFilesystem(input: EvaluationWorkerInput): PreparedEvaluationWorkerFilesystem {
  assertEvaluationWorkerInput(input);
  if (existsSync(input.workerRoot)) throw new Error('Evaluation worker root already exists');
  inspectFixtureTree(input.fixtureDb);
  inspectFixtureTree(input.fixtureConfig);
  const root = realpathSync(input.fixtureRoot);
  if (!temporaryPath(root) || !isUnder(root, realpathSync(input.fixtureDb)) ||
      !isUnder(root, realpathSync(input.fixtureConfig))) {
    throw new Error('Evaluation fixture resolved outside its approved root');
  }
  const configFile = join(input.fixtureConfig, 'opencode.json');
  const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  const mcp = parsed.mcp;
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp) || !Object.keys(mcp).length ||
      Object.values(mcp).some((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
        const candidate = value as Record<string, unknown>;
        return candidate.type !== 'local' || !Array.isArray(candidate.command) ||
          !candidate.command.length || !candidate.command.every((part) => typeof part === 'string' && part.length > 0);
      })) {
    throw new Error('Evaluation fixture requires a safe local-command MCP map');
  }
  const homePath = join(input.workerRoot, 'home');
  const dbPath = join(input.workerRoot, 'rhythm.db');
  const configPath = join(homePath, '.config', 'opencode');
  const workspacePath = join(input.workerRoot, 'workspace');
  mkdirSync(configPath, { recursive: true, mode: 0o700 });
  mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
  mkdirSync(join(input.workerRoot, 'mcp-roles'), { recursive: true, mode: 0o700 });
  copyFileSync(input.fixtureDb, dbPath);
  cpSync(input.fixtureConfig, configPath, { recursive: true, force: false, errorOnExist: false });
  chmodSync(dbPath, 0o600);
  chmodSync(join(configPath, 'opencode.json'), 0o600);
  return { homePath, dbPath, configPath, workspacePath };
}

/** Never inherit the parent API's account, production, or provider credentials. */
export function buildEvaluationWorkerEnvironment(
  input: EvaluationWorkerInput,
  prepared: PreparedEvaluationWorkerFilesystem,
  engineBinary: string,
  relayToken: string,
): NodeJS.ProcessEnv {
  assertEvaluationWorkerInput(input);
  if (!temporaryPath(engineBinary) || !engineBinary.endsWith('/opencode') || !relayToken) {
    throw new Error('Evaluation requires a pinned temporary engine and an ephemeral relay token');
  }
  if (!isUnder(resolve(input.workerRoot), resolve(prepared.homePath)) ||
      !isUnder(resolve(input.workerRoot), resolve(prepared.dbPath)) ||
      !isUnder(resolve(input.workerRoot), resolve(prepared.configPath)) ||
      !isUnder(resolve(input.workerRoot), resolve(prepared.workspacePath))) {
    throw new Error('Evaluation worker paths escaped the private root');
  }
  return {
    PATH: process.env.PATH,
    HOME: prepared.homePath,
    TMPDIR: join(input.workerRoot, 'tmp'),
    XDG_CONFIG_HOME: join(prepared.homePath, '.config'),
    XDG_DATA_HOME: join(prepared.homePath, '.local', 'share'),
    XDG_CACHE_HOME: join(prepared.homePath, '.cache'),
    DB_CLIENT: 'sqlite',
    DB_PATH: prepared.dbPath,
    OPENCODE_CONFIG_DIR: prepared.configPath,
    RHYTHM_OPENCODE_CONFIG_PATH: join(prepared.configPath, 'opencode.json'),
    OPENCODE_DB: join(input.workerRoot, 'opencode.db'),
    MCP_ROLES_DIR: join(input.workerRoot, 'mcp-roles'),
    RHYTHM_OPENCODE_BIN: engineBinary,
    RHYTHM_OPENCODE_ENGINE_PORT: String(input.enginePort),
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    RHYTHM_OPTIMIZER_MODE: 'shadow',
    RHYTHM_EVALUATION_WORKER: '1',
    RHYTHM_EVALUATION_PROVIDER_RELAY_URL: input.providerRelayUrl,
    RHYTHM_EVALUATION_PROVIDER_RELAY_TOKEN: relayToken,
    ...(input.webhookPort ? { RHYTHM_EVALUATION_WEBHOOK_PORT: String(input.webhookPort) } : {}),
    ...(input.publicationBaseURL ? {
      PROD_API_URL: input.publicationBaseURL,
      PROD_AUTH_TOKEN: input.publicationToken,
      RHYTHM_EVALUATION_PUBLICATION_URL: input.publicationBaseURL,
    } : {}),
    ...(input.externalSource ? {
      RHYTHM_EVALUATION_EXTERNAL_SOURCE_URL: input.externalSource.url,
      RHYTHM_EVALUATION_EXTERNAL_SOURCE_SHA256: input.externalSource.sha256,
      RHYTHM_EVALUATION_EXTERNAL_RECEIVER_URL: input.externalSource.receiverURL,
      RHYTHM_EVALUATION_EXTERNAL_RECEIVER_TOKEN: input.externalSource.token,
    } : {}),
  };
}

function policyString(path: string): string {
  return `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * The worker and its engine inherit a macOS sandbox that denies user/temp
 * reads outside pinned program roots, all external writes, and non-lease
 * network destinations. Node requires system reads to remain available.
 */
export function evaluationSandboxPolicy(input: {
  workerRoot: string; programRoots: string[]; enginePort: number; relayPort: number;
  webhookPort?: number; publicationPort?: number; externalSourcePort?: number;
}): string {
  if (!temporaryPath(input.workerRoot) || input.programRoots.length === 0 ||
      !Number.isInteger(input.enginePort) || !Number.isInteger(input.relayPort)) {
    throw new Error('Evaluation sandbox roots are invalid');
  }
  const readable = [
    '/usr', '/System', '/Library', '/private/etc', '/dev',
    realpathSync(input.workerRoot),
    ...input.programRoots.flatMap((path) => [resolve(path), realpathSync(path)]),
  ];
  const ancestorPaths = new Set<string>();
  for (const path of readable) {
    let parent = dirname(path);
    while (parent !== '/' && !ancestorPaths.has(parent)) {
      ancestorPaths.add(parent);
      parent = dirname(parent);
    }
  }
  return [
    '(version 1)',
    // Node's native os binding aborts under macOS deny-default profiles even
    // when its known file/system services are explicitly allowed. Keep system
    // reads available, but deny user/temp trees and every external write or
    // network destination, then reopen only the worker and exact ports.
    '(allow default)',
    '(deny file-read* (subpath "/Users"))',
    '(deny file-read* (subpath "/private/tmp"))',
    '(deny file-read* (subpath "/tmp"))',
    '(deny file-read* (subpath "/Volumes"))',
    '(deny file-read* (subpath "/private/var/folders"))',
    '(deny file-write*)',
    '(deny network*)',
    '(deny process-info*)',
    '(deny signal)',
    '(deny mach-lookup)',
    '(deny mach-task*)',
    '(deny iokit*)',
    '(deny appleevent-send)',
    '(allow file-read* (literal "/Users"))',
    '(allow file-read* (literal "/private/tmp"))',
    '(allow file-read* (literal "/tmp"))',
    '(allow file-read* (literal "/private/var/folders"))',
    ...[...ancestorPaths].map((path) => `(allow file-read* (literal ${policyString(path)}))`),
    ...readable.flatMap((path) => lstatSync(path).isDirectory()
      ? [`(allow file-read* (literal ${policyString(path)}))`,
        `(allow file-read* (subpath ${policyString(path)}))`]
      : [`(allow file-read* (literal ${policyString(path)}))`]),
    `(allow file-write* (subpath ${policyString(realpathSync(input.workerRoot))}))`,
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow process-info* (target self))',
    '(allow process-info* (target children))',
    '(allow signal (target self))',
    '(allow signal (target children))',
    `(allow network-outbound (remote ip "localhost:${input.relayPort}"))`,
    `(allow network-outbound (remote ip "localhost:${input.enginePort}"))`,
    `(allow network-inbound (local ip "localhost:${input.enginePort}"))`,
    ...(input.webhookPort ? [
      `(allow network-outbound (remote ip "localhost:${input.webhookPort}"))`,
      `(allow network-inbound (local ip "localhost:${input.webhookPort}"))`,
    ] : []),
    ...(input.publicationPort ? [
      `(allow network-outbound (remote ip "localhost:${input.publicationPort}"))`,
    ] : []),
    ...(input.externalSourcePort ? [
      `(allow network-outbound (remote ip "localhost:${input.externalSourcePort}"))`,
    ] : []),
  ].join('\n');
}

interface EvaluationSandboxRunInput {
  worker: EvaluationWorkerInput;
  request: Omit<EvaluationMaterializeRequest, 'dbPath' | 'workerRoot'>;
  engineBinary: string;
  relayToken: string;
  timeoutMs?: number;
}

interface EvaluationSandboxExecuteInput extends EvaluationSandboxRunInput {
  execution: Omit<EvaluationExecuteRequest,
    keyof EvaluationMaterializeRequest | 'workspacePath'>;
}

/** Materialize with the production validator/applier inside a disposable child. */
export function materializeCandidateInSandboxAsync(input: EvaluationSandboxRunInput): Promise<EvaluationMaterializedConfiguration>;
export function materializeCandidateInSandboxAsync(input: EvaluationSandboxExecuteInput): Promise<EvaluationWorkerExecution>;
export async function materializeCandidateInSandboxAsync(
  input: EvaluationSandboxRunInput | EvaluationSandboxExecuteInput,
): Promise<EvaluationMaterializedConfiguration | EvaluationWorkerExecution> {
  const prepared = prepareEvaluationWorkerFilesystem(input.worker);
  mkdirSync(join(input.worker.workerRoot, 'tmp'), { mode: 0o700 });
  const sourceBinary = realpathSync(input.engineBinary);
  if (!lstatSync(sourceBinary).isFile()) throw new Error('Evaluation engine source is not a regular file');
  const pinnedBinary = join(input.worker.workerRoot, 'opencode');
  const sourceHash = createHash('sha256').update(readFileSync(sourceBinary)).digest('hex');
  copyFileSync(sourceBinary, pinnedBinary);
  chmodSync(pinnedBinary, 0o500);
  if (createHash('sha256').update(readFileSync(pinnedBinary)).digest('hex') !== sourceHash) {
    throw new Error('Evaluation engine binary changed while staging');
  }
  const environment = buildEvaluationWorkerEnvironment(
    input.worker, prepared, pinnedBinary, input.relayToken,
  );
  if ('execution' in input) {
    const fixtureDir = join(prepared.workspacePath, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(fixtureDir, 'request.json'), JSON.stringify({
      key: input.execution.task.key, prompt: input.execution.task.prompt,
    }), { mode: 0o400 });
  }
  const modulePath = join(__dirname, 'org_evaluation_worker_entry.js');
  const apiRoot = resolve(__dirname, '../..');
  const distRoot = resolve(__dirname, '..');
  const policyPath = join(input.worker.workerRoot, 'worker.sb');
  writeFileSync(policyPath, evaluationSandboxPolicy({
    workerRoot: input.worker.workerRoot,
    enginePort: input.worker.enginePort,
    relayPort: Number(new URL(input.worker.providerRelayUrl).port),
    webhookPort: input.worker.webhookPort,
    publicationPort: input.worker.publicationBaseURL
      ? Number(new URL(input.worker.publicationBaseURL).port) : undefined,
    externalSourcePort: input.worker.externalSource
      ? Number(new URL(input.worker.externalSource.receiverURL).port) : undefined,
    programRoots: [
      distRoot,
      resolve(apiRoot, 'package.json'),
      resolve(apiRoot, 'node_modules'),
      resolve(apiRoot, 'vendor/opencode-ai-sdk'),
      resolve(apiRoot, 'node_modules/@opencode-ai/sdk'),
      resolve(apiRoot, '../..', 'node_modules'),
      pinnedBinary,
      resolve(process.execPath),
    ].filter(existsSync),
  }), { mode: 0o600 });
  const request = {
    ...input.request, dbPath: prepared.dbPath, workerRoot: input.worker.workerRoot,
    workspacePath: prepared.workspacePath,
    ...('execution' in input ? {
      ...input.execution,
      workspacePath: prepared.workspacePath,
      mode: 'execute' as const,
    } : {}),
  };
  return await new Promise<EvaluationMaterializedConfiguration | EvaluationWorkerExecution>((resolveResult, rejectResult) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', policyPath, process.execPath, modulePath], {
      env: environment, cwd: prepared.workspacePath, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
    let stdout = '';
    let stderr = '';
    const limit = 256_000;
    const timeout = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already exited */ }
    }, Math.min(input.timeoutMs ?? 30_000, 120_000));
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString('utf8');
      if (stdout.length > limit) child.kill('SIGKILL');
    });
    child.stderr.on('data', (bytes: Buffer) => {
      stderr += bytes.toString('utf8');
      if (stderr.length > limit) child.kill('SIGKILL');
    });
    child.on('error', (error) => { clearTimeout(timeout); rejectResult(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectResult(new Error(`Evaluation sandbox failed (${code}, ${signal ?? 'no-signal'}): ${stderr.slice(-2000)}`));
        return;
      }
      const marker = stdout.split('\n').find((line) => line.startsWith('RHYTHM_EVALUATION_RESULT:'));
      if (!marker) { rejectResult(new Error('Evaluation sandbox returned no materialization receipt')); return; }
      try {
        resolveResult(JSON.parse(marker.slice('RHYTHM_EVALUATION_RESULT:'.length)) as
          EvaluationMaterializedConfiguration | EvaluationWorkerExecution);
      } catch { rejectResult(new Error('Evaluation sandbox returned malformed materialization receipt')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export interface OrgEvaluationRuntimeAdapterOptions {
  /** A previously built single-file fork engine binary; never launched by prepare. */
  engineBinary: string;
  /** Existing owned directory under /private/tmp; each arm creates fresh children. */
  workerBaseRoot: string;
  /** Generation model only; each candidate executes its frozen effective model. */
  model: { providerID: string; modelID: string };
  createLease(input: { jobId: string; stage: OrgEvaluationStage; model: string; maxCalls: number }):
    Promise<{ leaseId: string; baseURL: string; token: string }> | { leaseId: string; baseURL: string; token: string };
  finishLease(leaseId: string): Promise<OrgEvaluationTokenUsage | null> | OrgEvaluationTokenUsage | null;
  getObservedToolCatalog(leaseId: string): Array<{ providerRequestHash: string; toolNames: string[];
    deferredCatalog: import('./org_evaluation_scope_effects').ObservedDeferredCatalog | null }> | null;
  enginePort(): number;
  wallMs?: number;
}

export function evaluationArmModel(snapshot: OrgEvaluationTargetSnapshot, kind: OrgEvaluationProposalKind,
  changeJson: string, role: 'original' | 'variant' | 'composition' | 'final'): {
    providerID: string; modelID: string;
  } {
  let model: { providerID: string; modelID: string } = {
    providerID: snapshot.effectiveModel.providerID, modelID: snapshot.effectiveModel.modelID,
  };
  if (kind === 'create-agent' && role === 'original') {
    const baseline = snapshot.profiles.find((profile) => profile.id === snapshot.creationControl?.baselineProfileId);
    if (!baseline) throw new Error('Creation evaluation has no verified baseline profile');
    if (baseline.modelProvider && baseline.modelId) {
      model = { providerID: baseline.modelProvider, modelID: baseline.modelId };
    }
  }
  if (kind === 'refine-config' && role !== 'original') {
    const patch = (JSON.parse(changeJson) as { configPatch?: { field?: string; value?: unknown } }).configPatch;
    if (patch?.field === 'model') {
      const value = patch.value;
      if (typeof value !== 'string' || !value.includes('/')) {
        throw new Error('Evaluation cannot resolve an unpinned model patch from the frozen baseline');
      }
      const slash = value.indexOf('/');
      model = { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
    }
  }
  if (!((model.providerID === 'anthropic' && /^claude-[A-Za-z0-9._-]+$/.test(model.modelID)) ||
      (model.providerID === 'openai' && /^[A-Za-z0-9._-]+$/.test(model.modelID)))) {
    throw new Error('Evaluation has no bounded provider adapter for the actual production model');
  }
  return model;
}

async function startPublicationForArm(snapshot: OrgEvaluationTargetSnapshot, changeJson: string,
  baseline: boolean): Promise<{
    receiver: Awaited<ReturnType<typeof startOrgEvaluationPublishReceiverAsync>>;
    token: string; name: string; action: 'publish' | 'unpublish' | 'none';
  } | null> {
  if (snapshot.kind !== 'publish-skill-to-org') return null;
  const binding = publicationReceiverInput({ snapshot, changeJson, baseline });
  const token = randomUUID() + randomUUID();
  const receiver = await startOrgEvaluationPublishReceiverAsync({ ...binding, token });
  return { receiver, token, name: binding.expectedSkillName, action: binding.action };
}

async function startExternalSourceForArm(snapshot: OrgEvaluationTargetSnapshot, changeJson: string,
  baseline: boolean): Promise<{
    receiver: Awaited<ReturnType<typeof startExternalSkillReceiverAsync>>;
    token: string; source: ReturnType<typeof externalSkillReceiverInput>;
  } | null> {
  if (snapshot.kind !== 'external-adoption') return null;
  const source = externalSkillReceiverInput({ snapshot, changeJson, baseline });
  const token = randomUUID() + randomUUID();
  const receiver = await startExternalSkillReceiverAsync({ source, token });
  return { receiver, token, source };
}

/** Parent API boundary. All candidate bytes are applied in a new sandboxed worker. */
export function createOrgEvaluationRuntimeAdapter(options: OrgEvaluationRuntimeAdapterOptions): OrgEvaluationRuntimePort {
  if (!temporaryPath(options.workerBaseRoot) || !existsSync(options.workerBaseRoot) ||
      !options.model.providerID || !options.model.modelID) {
    throw new Error('Evaluation runtime requires an owned temporary root and a pinned generation model');
  }
  const prepare: OrgEvaluationRuntimePort['prepare'] = async (input) => {
    const executionModel = evaluationArmModel(input.snapshot, input.kind, input.changeJson, input.role);
    const id = randomUUID();
    const fixtureRoot = join(options.workerBaseRoot, `fixture-${id}`);
    const workerRoot = join(options.workerBaseRoot, `worker-${id}`);
    const url = 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/prepare_only/v1';
    const publication = await startPublicationForArm(input.snapshot, input.changeJson,
      input.role === 'original');
    const externalSource = await startExternalSourceForArm(input.snapshot, input.changeJson,
      input.role === 'original');
    try {
      const fixture = prepareOrgEvaluationFixture(input.snapshot, {
        fixtureRoot, safeMcpCommand: [process.execPath, join(__dirname, 'org_evaluation_mcp_fixture.js')], providerRelayUrl: url,
        relayToken: 'prepare-only-no-provider-access', executionModel,
        publicationBaseURL: publication?.receiver.baseURL,
      });
      const result = await materializeCandidateInSandboxAsync({
        worker: {
          candidateId: id, kind: input.kind, targetRef: input.targetRef,
          fixtureRoot: fixture.fixtureRoot, fixtureDb: fixture.fixtureDb,
          fixtureConfig: fixture.fixtureConfig, workerRoot,
          enginePort: options.enginePort(), providerRelayUrl: url,
          publicationBaseURL: publication?.receiver.baseURL,
          publicationToken: publication?.token,
          externalSource: externalSource ? {
            url: externalSource.source.downloadUrl,
            sha256: externalSource.source.contentSha256,
            receiverURL: externalSource.receiver.baseURL,
            token: externalSource.token,
          } : undefined,
        },
        request: {
          candidateId: id, kind: input.kind, targetRef: input.targetRef,
          changeJson: input.changeJson, baseline: input.role === 'original',
          profileIds: input.snapshot.profiles.map((profile) => profile.id),
          executionModel,
          publicationName: publication?.name,
          proposal: input.proposal,
          bootstrapEngine: true,
        },
        engineBinary: options.engineBinary,
        relayToken: 'prepare-only-no-provider-access', timeoutMs: options.wallMs,
      });
      return { manifestJson: result.manifestJson, manifestHash: result.manifestHash };
    } finally {
      await publication?.receiver.close();
      await externalSource?.receiver.close();
      rmSync(workerRoot, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  };
  return {
    prepare,
    execute: async (input) => {
      const executionModel = evaluationArmModel(input.snapshot, input.candidate.kind,
        input.candidate.changeJson, input.candidate.role);
      const id = randomUUID();
      const fixtureRoot = join(options.workerBaseRoot, `fixture-${id}`);
      const workerRoot = join(options.workerBaseRoot, `worker-${id}`);
      const guardSentinelPath = join(options.workerBaseRoot, `guard-${id}`);
      writeFileSync(guardSentinelPath, 'guard-unchanged', { mode: 0o400 });
      const guard = createServer((_request, response) => response.end('sandbox-network-escape'));
      await new Promise<void>((resolveListen, rejectListen) => {
        guard.once('error', rejectListen);
        guard.listen(0, '127.0.0.1', resolveListen);
      });
      const guardAddress = guard.address();
      if (!guardAddress || typeof guardAddress === 'string') throw new Error('Evaluation guard listener unavailable');
      let lease: Awaited<ReturnType<OrgEvaluationRuntimeAdapterOptions['createLease']>> | null = null;
      let usage: OrgEvaluationTokenUsage | null = null;
      const publication = await startPublicationForArm(input.snapshot, input.candidate.changeJson,
        input.candidate.role === 'original');
      const externalSource = await startExternalSourceForArm(input.snapshot, input.candidate.changeJson,
        input.candidate.role === 'original');
      try {
        lease = await options.createLease({
          jobId: input.jobId, stage: input.stage, model: executionModel.modelID, maxCalls: 8,
        });
        const fixture = prepareOrgEvaluationFixture(input.snapshot, {
          fixtureRoot, safeMcpCommand: [process.execPath, join(__dirname, 'org_evaluation_mcp_fixture.js')],
          providerRelayUrl: lease.baseURL, relayToken: lease.token, executionModel,
          publicationBaseURL: publication?.receiver.baseURL,
        });
        const execution = await materializeCandidateInSandboxAsync({
          worker: {
            candidateId: input.candidate.id, kind: input.candidate.kind,
            targetRef: input.candidate.targetRef,
            fixtureRoot: fixture.fixtureRoot, fixtureDb: fixture.fixtureDb,
            fixtureConfig: fixture.fixtureConfig, workerRoot,
            enginePort: options.enginePort(), providerRelayUrl: lease.baseURL,
            publicationBaseURL: publication?.receiver.baseURL,
            publicationToken: publication?.token,
            externalSource: externalSource ? {
              url: externalSource.source.downloadUrl,
              sha256: externalSource.source.contentSha256,
              receiverURL: externalSource.receiver.baseURL,
              token: externalSource.token,
            } : undefined,
            ...(input.candidate.kind === 'webhook-wiring' ? { webhookPort: randomInt(60001, 64000) } : {}),
          },
          request: {
            candidateId: input.candidate.id, kind: input.candidate.kind,
            targetRef: input.candidate.targetRef, changeJson: input.candidate.changeJson,
            baseline: input.candidate.role === 'original',
            profileIds: input.snapshot.profiles.map((profile) => profile.id),
            executionModel,
            publicationName: publication?.name,
            proposal: input.proposal,
          },
          execution: {
            expectedManifestHash: input.candidate.configHash,
            task: input.task, model: executionModel,
            guardSentinelPath,
            guardNetworkUrl: `http://127.0.0.1:${guardAddress.port}/guard`,
          },
          engineBinary: options.engineBinary,
          relayToken: lease.token,
          timeoutMs: options.wallMs ?? 120_000,
        });
        if (readFileSync(guardSentinelPath, 'utf8') !== 'guard-unchanged') {
          throw new Error('Evaluation worker mutated its parent guard sentinel');
        }
        const providerToolCatalogs = options.getObservedToolCatalog(lease.leaseId);
        usage = await options.finishLease(lease.leaseId);
        lease = null;
        if (!usage) throw new Error('Evaluation provider usage was unavailable or incomplete');
        if (execution.output.length > 16_384) {
          throw new Error('Evaluation output exceeded the bounded receipt limit');
        }
        const scopeProof = verifyScopeDelegationEffects({
          kind: input.candidate.kind,
          changeJson: input.candidate.changeJson,
          snapshot: input.snapshot,
          toolEvents: execution.toolEvents,
          fixtureToolEvents: execution.fixtureToolEvents,
          providerToolCatalogs,
          observedEffects: execution.observedEffects,
          trustedFixtureServers: ['evaluation-fixture'],
        });
        execution.observedEffects.push(...scopeProof.events);
        const required = input.candidate.role === 'original'
          ? input.candidate.kind === 'create-recipe' || input.candidate.kind === 'webhook-wiring'
            ? ['target-absent']
            : input.candidate.kind === 'refine-recipe' ? ['recipe-selected']
            : input.candidate.kind === 'refine-task' ? ['scheduled-task-fired']
            : ['agent-output'] : requiredEffectEvidence(input.candidate.kind, input.candidate.changeJson);
        const publicationObservations = publication
          ? await publication.receiver.observations() : null;
        const externalObservations = externalSource
          ? await externalSource.receiver.observations() : null;
        const publicationEvents: EvaluationWorkerExecution['observedEffects'] = [];
        if (publication && publicationObservations) {
          const skillPath = `/org-skills/${encodeURIComponent(publication.name)}`;
          const actionMethod = publication.action === 'publish' ? 'POST' : 'DELETE';
          const actionStatus = publication.action === 'publish' ? 201 : 204;
          const actionObserved = publicationObservations.requests.find((item) =>
            item.method === actionMethod && item.path === skillPath && item.status === actionStatus);
          if (publication.action !== 'none' && actionObserved) {
            publicationEvents.push({
              kind: publication.action === 'publish' ? 'loopback-org-publish-received' :
                'loopback-org-unpublish-received',
              source: 'loopback-receiver', subject: publication.name,
              evidenceHash: createHash('sha256').update(JSON.stringify(actionObserved)).digest('hex'),
            });
          }
          const engineFetch = publicationObservations.requests.find((item) =>
            item.client === 'engine' && item.method === 'GET' &&
            item.path === `${skillPath}/SKILL.md` && item.status === 200 &&
            item.contentHash && publicationObservations.publishedBody !== null &&
            item.contentHash === createHash('sha256')
              .update(publicationObservations.publishedBody).digest('hex'));
          if (engineFetch && publication.action === 'publish') {
            publicationEvents.push({ kind: 'org-skill-fetch', source: 'loopback-receiver',
              subject: publication.name, evidenceHash: engineFetch.contentHash! });
          }
          const unavailable = unpublishedOrgSkillEvent({ name: publication.name,
            action: publication.action, publishedBody: publicationObservations.publishedBody,
            requests: publicationObservations.requests });
          if (unavailable) publicationEvents.push(unavailable);
        }
        execution.observedEffects.push(...publicationEvents);
        if (externalSource && externalObservations?.some((entry) =>
          entry.path === '/source/SKILL.md' && entry.status === 200 &&
          entry.bodyHash === externalSource.source.contentSha256)) {
          execution.observedEffects.push({ kind: 'artifact-provenance-verified',
            source: 'loopback-receiver', subject: externalSource.source.skillName,
            evidenceHash: externalSource.source.contentSha256 });
        }
        const observed = execution.observedEffects.map((event) => event.kind);
        const proof = verifyObservedEffects(input.candidate.kind, observed, input.candidate.changeJson);
        const missing = input.candidate.role === 'original'
          ? required.filter((kind) => !observed.includes(kind)) : proof.missing;
        const positive = input.task.outputIncludes.filter((needle) =>
          execution.output.toLowerCase().includes(needle.toLowerCase()));
        const forbidden = input.task.outputExcludes.filter((needle) =>
          execution.output.toLowerCase().includes(needle.toLowerCase()));
        const score = input.candidate.role === 'original' &&
          (input.candidate.kind === 'create-recipe' || input.candidate.kind === 'webhook-wiring')
          ? 0 : forbidden.length ? 0 : input.task.outputIncludes.length
          ? positive.length / input.task.outputIncludes.length : 1;
        const status = missing.length ? 'inconclusive' : 'pass';
        const receiptJson = JSON.stringify({
          sessionId: execution.sessionId, engineVersion: execution.engineVersion,
          engineBootId: execution.engineBootId,
          executionModel,
          taskFixtureHash: execution.taskFixtureHash,
          effectiveConfigHash: execution.manifestHash,
          outputHash: execution.outputHash,
          outputText: execution.output,
          providerToolCatalogs,
          positiveChecksMatched: positive, forbiddenChecksMatched: forbidden,
          toolEvents: execution.toolEvents,
          fixtureToolEvents: execution.fixtureToolEvents,
          guardDetails: execution.guardDetails,
          effectProof: {
            manifestHash: execution.manifestHash,
            events: execution.observedEffects.map((event) => ({ ...event, observedAt: new Date().toISOString() })),
            negativeGuardsPassed: execution.negativeGuardsPassed,
            workerId: id,
            workerRootHash: createHash('sha256').update(workerRoot).digest('hex'),
            engineBootId: execution.engineBootId,
          },
        });
        return { receiptJson, status, score, tokenUsage: usage,
          failureReason: missing.length ? `Missing actual effect proof: ${missing.join(', ')}${
            scopeProof.reason ? `; ${scopeProof.reason}` : ''}` : null };
      } finally {
        await publication?.receiver.close();
        await externalSource?.receiver.close();
        if (lease) await options.finishLease(lease.leaseId);
        await new Promise<void>((resolveClose) => guard.close(() => resolveClose()));
        rmSync(workerRoot, { recursive: true, force: true });
        rmSync(fixtureRoot, { recursive: true, force: true });
        rmSync(guardSentinelPath, { force: true });
      }
    },
  };
}
