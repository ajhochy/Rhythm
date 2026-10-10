import { createHash } from 'node:crypto';
import { posix } from 'node:path';

/** One fixed disposable coding task, not a generic permission/grant language. */
export interface CodingExecutionProfile {
  profileId: string;
  revision: number;
  policyFingerprint: string;
  providerId: string;
  modelId: string;
  modelVersion: string;
  reasoningEffort: string;
}

export interface CoordinatorCodingExecutionProposal {
  schemaVersion: 1;
  purpose: 'coordinator_coding_execution_v1';
  proposalId: string;
  ownerUserId: number;
  sessionId: string;
  projectId: string;
  sdkSessionId: string;
  profileId: string;
  profileRevision: number;
  scopeFingerprint: string;
  controlRevision: number;
  goalId: string;
  goalRevision: number;
  objective: string;
  normalizedIntentHash: string;
  workspace: {
    id: string; generation: number; canonicalRoot: string; baseDigest: string;
    readablePaths: string[]; writablePaths: string[];
  };
  chain: {
    transport: 'rhythm_delegate_async';
    manager: CodingExecutionProfile;
    worker: CodingExecutionProfile;
  };
  command: {
    id: 'selectTasks-tests-v1'; cwd: string; executable: string; executableDigest: string;
    loaderDigest: string; argv: ['--import', string, '--test', 'tests/selectTasks.test.mjs'];
    env: Record<string, never>; shellCommand: string;
  };
  limits: {
    managerAttempts: 1; workerAttempts: 1; concurrentWorkers: 1; automaticRetries: 0;
    managerCompletionWakes: 1; rootCompletionWakes: 0; taskWallSeconds: 600;
    workerWallSeconds: 300; totalSoftTokens: number; includesManagerCompletion: true;
  };
  acceptance: {
    evaluatorId: 'selectTasks-independent-v1'; version: 1; evaluatorDigest: string;
    runnerDigest: string; writableByWorker: false; capture: 'immutable_allowed_bytes_v1';
    criteria: string[];
  };
  proposedAt: string;
  expiresAt: string;
}

const checks = ['open', 'done', 'omitted', 'empty_no_match', 'order', 'unsupported_status', 'input_preservation'];
const writes = ['src/selectTasks.ts', 'tests/selectTasks.test.mjs'];
const reads = [...writes, 'package.json', 'tsconfig.json'];
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4000 && v.trim() === v;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown, min = 1) => Number.isSafeInteger(v) && Number(v) >= min;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string): v is Record<string, unknown> => object(v) &&
  Object.keys(v).length === keys.split(' ').length && keys.split(' ').every(k => Object.hasOwn(v, k));
const canonicalAbsolute = (v: unknown): v is string => text(v) && v !== '/' &&
  /^\/[A-Za-z0-9._/-]+$/.test(v) && posix.normalize(v) === v && !v.split('/').includes('..');
const paths = (v: unknown, allowed: string[]): v is string[] => Array.isArray(v) && v.length > 0 &&
  v.length <= allowed.length && new Set(v).size === v.length && v.every(p => allowed.includes(p));
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;

/** Relevant intent excludes unrelated chat controlRevision and proposal nonce/time. */
export function codingExecutionIntentHash(p: Omit<CoordinatorCodingExecutionProposal, 'normalizedIntentHash'>): string {
  return hash({ ownerUserId: p.ownerUserId, sessionId: p.sessionId, projectId: p.projectId,
    sdkSessionId: p.sdkSessionId, profileId: p.profileId, profileRevision: p.profileRevision,
    scopeFingerprint: p.scopeFingerprint, goalId: p.goalId, goalRevision: p.goalRevision,
    objective: p.objective, workspace: p.workspace, chain: p.chain, command: p.command,
    limits: p.limits, acceptance: p.acceptance });
}

function profile(v: unknown, id: string): boolean {
  return exact(v, 'profileId revision policyFingerprint providerId modelId modelVersion reasoningEffort') &&
    v.profileId === id && integer(v.revision, 0) && digest(v.policyFingerprint) &&
    [v.providerId, v.modelId, v.modelVersion, v.reasoningEffort].every(text);
}

/** Closed schema; this validates terms, NEVER establishes human consent or current policy. */
export function parseCodingExecutionProposal(value: unknown): CoordinatorCodingExecutionProposal | null {
  if (!exact(value, 'schemaVersion purpose proposalId ownerUserId sessionId projectId sdkSessionId profileId profileRevision scopeFingerprint controlRevision goalId goalRevision objective normalizedIntentHash workspace chain command limits acceptance proposedAt expiresAt') ||
      value.schemaVersion !== 1 || value.purpose !== 'coordinator_coding_execution_v1' ||
      !integer(value.ownerUserId) || !integer(value.profileRevision, 0) || !integer(value.controlRevision) ||
      !integer(value.goalRevision) || !digest(value.scopeFingerprint) || !digest(value.normalizedIntentHash) ||
      ![value.proposalId, value.sessionId, value.projectId, value.sdkSessionId, value.profileId, value.goalId, value.objective].every(text) ||
      !timestamp(value.proposedAt) || !timestamp(value.expiresAt) ||
      Date.parse(value.expiresAt) - Date.parse(value.proposedAt) !== 900_000) return null;
  const w = value.workspace;
  if (!exact(w, 'id generation canonicalRoot baseDigest readablePaths writablePaths') || !text(w.id) ||
      !integer(w.generation) || !canonicalAbsolute(w.canonicalRoot) || !digest(w.baseDigest) ||
      !paths(w.readablePaths, reads) || !paths(w.writablePaths, writes) ||
      !w.writablePaths.includes('src/selectTasks.ts')) return null;
  const readablePaths = w.readablePaths;
  if (!w.writablePaths.every(p => readablePaths.includes(p))) return null;
  const c = value.chain;
  if (!exact(c, 'transport manager worker') || c.transport !== 'rhythm_delegate_async' ||
      !profile(c.manager, 'workflow-orchestrator') || !profile(c.worker, 'coding-agent')) return null;
  const cmd = value.command;
  if (!exact(cmd, 'id cwd executable executableDigest loaderDigest argv env shellCommand') ||
      cmd.id !== 'selectTasks-tests-v1' || cmd.cwd !== w.canonicalRoot || !canonicalAbsolute(cmd.executable) ||
      posix.basename(cmd.executable) !== 'node' || !digest(cmd.executableDigest) || !digest(cmd.loaderDigest) ||
      !Array.isArray(cmd.argv) || cmd.argv.length !== 4 || cmd.argv[0] !== '--import' ||
      !canonicalAbsolute(cmd.argv[1]) || !cmd.argv[1].endsWith('/tsx/dist/loader.mjs') ||
      cmd.argv[2] !== '--test' || cmd.argv[3] !== 'tests/selectTasks.test.mjs' ||
      !(object(cmd.env) && Object.keys(cmd.env).length === 0)) return null;
  const quote=(part:string)=>"'"+part.replace(/'/g,"'\"'\"'")+"'";
  if (cmd.shellCommand !== [cmd.executable,...cmd.argv].map(quote).join(' ')) return null;
  const l = value.limits;
  if (!exact(l, 'managerAttempts workerAttempts concurrentWorkers automaticRetries managerCompletionWakes rootCompletionWakes taskWallSeconds workerWallSeconds totalSoftTokens includesManagerCompletion') ||
      l.managerAttempts !== 1 || l.workerAttempts !== 1 || l.concurrentWorkers !== 1 || l.automaticRetries !== 0 ||
      l.managerCompletionWakes !== 1 || l.rootCompletionWakes !== 0 || l.taskWallSeconds !== 600 ||
      l.workerWallSeconds !== 300 || l.includesManagerCompletion !== true || !integer(l.totalSoftTokens) ||
      Number(l.totalSoftTokens) > 2_000_000) return null;
  const a = value.acceptance;
  if (!exact(a, 'evaluatorId version evaluatorDigest runnerDigest writableByWorker capture criteria') ||
      a.evaluatorId !== 'selectTasks-independent-v1' || a.version !== 1 || !digest(a.evaluatorDigest) ||
      !digest(a.runnerDigest) || a.writableByWorker !== false || a.capture !== 'immutable_allowed_bytes_v1' ||
      JSON.stringify(a.criteria) !== JSON.stringify(checks)) return null;
  const p = value as unknown as CoordinatorCodingExecutionProposal;
  return codingExecutionIntentHash(p) === p.normalizedIntentHash ? p : null;
}

/** No implicit 30k→75k expansion; the exact proposed allowance is visible in the signed card. */
export function codingExecutionApprovalPreview(p: CoordinatorCodingExecutionProposal): string {
  return `Goal: ${p.objective}\nWorkspace: ${p.workspace.canonicalRoot} (generation ${p.workspace.generation}, base ${p.workspace.baseDigest})\n` +
    `Writes ONLY: ${p.workspace.writablePaths.join(', ')}; reads ONLY: ${p.workspace.readablePaths.join(', ')}\n` +
    `Command ONLY: ${p.command.shellCommand}\nCommand cwd: ${p.command.cwd}; no additional environment overrides.\n` +
    `Manager ${p.chain.manager.profileId} (${p.chain.manager.providerId}/${p.chain.manager.modelId}@${p.chain.manager.modelVersion}) stays PLAN.\n` +
    `Worker ${p.chain.worker.profileId} (${p.chain.worker.providerId}/${p.chain.worker.modelId}@${p.chain.worker.modelVersion}) alone uses scoped DEFAULT, never bypass.\n` +
    `One manager, one worker, no descendants/retries; one manager completion, zero root completion inference.\n` +
    `${p.limits.totalSoftTokens.toLocaleString('en-US')} aggregate SOFT tokens (input/output/cache/reasoning counted once, including manager completion).\n` +
    `Task 600s / worker 300s; existing 10s watchdog durably revokes and attempts owned child abort on expiry (abort unavailable is reported as partial); absolute expiry ${p.expiresAt} = proposal +15m; approval never extends it.\n` +
    `Cancellation/revocation/current policy checked for every protected operation. Hard denies are NOT overridden.\n` +
    `Independent evaluator ${p.acceptance.evaluatorId}@${p.acceptance.version}, hash ${p.acceptance.evaluatorDigest}; not worker-writable.\n` +
    `No commit/push/deploy/install, unrelated MCP, additional commands or policy override. Engine scope is NOT OS/network confinement.\n` +
    `Intent ${p.normalizedIntentHash}; approval authorizes only these exact terms in this originating chat.`;
}
