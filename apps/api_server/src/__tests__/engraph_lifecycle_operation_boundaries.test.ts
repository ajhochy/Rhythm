/** Review fixture: real manager operations, injected CLI/child/HTTP only.
 * No _doStart/ensureStarted/_runIndex/_spawnServe/health/stop replacements.
 * No native Engraph executable, model, live vault or real child is launched.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngraphManager, type EngraphManagerDeps } from '../services/engraph_manager';
import { EngraphManagerConfigStore } from '../services/engraph_manager_config_store';

class Gate {
  entered = false;
  released = false;
  private resolve!: () => void;
  readonly promise = new Promise<void>((resolve) => { this.resolve = resolve; });
  async hold(): Promise<void> { this.entered = true; await this.promise; }
  release(): void { this.released = true; this.resolve(); }
}

class FixtureChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kills: string[] = [];
  exitGate: Gate | null = null;
  constructor(readonly pid: number) { super(); }
  kill(signal = 'SIGTERM'): boolean {
    this.kills.push(signal);
    if (this.exitCode !== null) return true;
    void (async () => {
      if (this.exitGate) await this.exitGate.hold();
      else await Promise.resolve();
      if (this.exitCode !== null) return;
      this.exitCode = 0;
      this.emit('exit', 0, signal);
    })();
    return true;
  }
}

type Call = { stage: 'validation' | 'index' | 'health' | 'read'; root?: string; home?: string; binary?: string; destructive?: boolean; signal?: AbortSignal };
type Fixture = { manager: EngraphManager; store: EngraphManagerConfigStore; calls: Call[]; children: FixtureChild[]; hold: Partial<Record<'validation' | 'index' | 'health', Gate>> };
let dir: string, rootA: string, rootB: string, binaryA: string, binaryB: string;
let fixtures: Fixture[] = [], gates: Gate[] = [];
let nextFixturePid = 700000;
const observations: Array<Record<string, unknown>> = [];
const observe = (caseName: string, value: Record<string, unknown>) => observations.push({ case: caseName, ...value });
const gate = (): Gate => { const g = new Gate(); gates.push(g); return g; };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function pumpUntil(done: () => boolean): Promise<void> {
  for (let n = 0; n < 40 && !done(); n++) {
    await turn();
    // Advance production debounce/spawn/cleanup timers; never sleep while held.
    await vi.advanceTimersByTimeAsync(350);
  }
  if (!done()) throw new Error('fixture operation did not reach its explicit boundary');
}
async function complete<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await pumpUntil(() => settled);
  return promise;
}

function make(): Fixture {
  const store = new EngraphManagerConfigStore(join(dir, `config-${fixtures.length}.json`));
  store.write({ enabled: true, executablePath: binaryA, approvedMemoryRoot: rootA });
  const calls: Call[] = [], children: FixtureChild[] = [];
  const hold: Fixture['hold'] = {};
  const execFileImpl: NonNullable<EngraphManagerDeps['execFileImpl']> = async (binary, args, options) => {
    const stage = args[0] === '--version' ? 'validation' : 'index';
    calls.push({ stage, binary, root: stage === 'index' ? args[1] : undefined,
      home: options.env?.HOME, destructive: args.includes('--rebuild'), signal: options.signal as AbortSignal | undefined });
    const barrier = hold[stage];
    if (barrier && !barrier.released) await barrier.hold();
    return { stdout: stage === 'validation' ? 'engraph 1.7.2\n' : '', stderr: '' };
  };
  const spawnFn: NonNullable<EngraphManagerDeps['spawnFn']> = ((..._args: unknown[]) => {
    const child = new FixtureChild(++nextFixturePid);
    children.push(child);
    return child;
  }) as unknown as NonNullable<EngraphManagerDeps['spawnFn']>;
  const fetchImpl: typeof fetch = async (_url, options) => {
    const query = JSON.parse(String(options?.body)).query as string;
    const stage = query === 'rhythm-engraph-health-check' ? 'health' : 'read';
    calls.push({ stage, signal: options?.signal ?? undefined });
    const barrier = stage === 'health' ? hold.health : undefined;
    if (barrier && !barrier.released) await barrier.hold();
    return new Response(JSON.stringify({ results: [{ file_path: 'fact/synthetic.md', snippet: 'Synthetic canonical reference evidence.', confidence: 0.8 }] }), { status: 200 });
  };
  const manager = new EngraphManager({ configStore: store, spawnFn, execFileImpl, fetchImpl, processListSync: () => [] });
  const fixture = { manager, store, calls, children, hold };
  fixtures.push(fixture);
  return fixture;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'engraph-operation-review-')));
  rootA = join(dir, 'vault-a', 'memory'); rootB = join(dir, 'vault-b', 'memory');
  mkdirSync(rootA, { recursive: true }); mkdirSync(rootB, { recursive: true });
  binaryA = join(dir, 'synthetic-engraph-a'); binaryB = join(dir, 'synthetic-engraph-b');
  for (const p of [binaryA, binaryB]) writeFileSync(p, '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  vi.stubEnv('MEMORY_VAULT_PATH', join(dir, 'vault-a'));
  vi.stubEnv('MEMORY_VAULT_SUBDIR', 'memory');
  vi.stubEnv('RHYTHM_ENGRAPH_HOME_DIR', join(dir, 'home-a'));
  vi.stubEnv('ENGRAPH_MEMORY_URL', '');
});
afterEach(async () => {
  for (const g of gates) g.release();
  for (const f of fixtures) for (const child of f.children) child.exitGate?.release();
  for (const f of fixtures) await complete(f.manager.shutdown());
  if (process.env.ENGRAPH_LIFECYCLE_REVIEW_OBSERVATIONS_PATH) writeFileSync(process.env.ENGRAPH_LIFECYCLE_REVIEW_OBSERVATIONS_PATH, JSON.stringify(observations, null, 2));
  fixtures = []; gates = [];
  vi.useRealTimers(); vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('R1: actual owner cancellation at submission', () => {
  for (const phase of ['index', 'health'] as const) for (const action of ['disable', 'rebuild', 'shutdown'] as const) {
    it(`${action} from a second view aborts the owner's held ${phase} before queue drain`, async () => {
      const owner = make(), view = make();
      await complete(owner.manager.enable()); await complete(view.manager.enable());
      const held = gate(); owner.hold[phase] = held;
      const starting = owner.manager.rebuild();
      let oldEndChildren = 0;
      void starting.then(() => { oldEndChildren = owner.children.length; });
      await pumpUntil(() => held.entered);
      const heldCall = owner.calls.filter(c => c.stage === phase).at(-1)!;
      const priorChildren = owner.children.length;
      const priorKills = owner.children.reduce((n, c) => n + c.kills.length, 0);
      let finished = false;
      const stopping = view.manager[action]().then(value => { finished = true; return value; });
      await turn();
      const beforeRelease = { aborted: heldCall.signal?.aborted, finished,
        kills: owner.children.reduce((n, c) => n + c.kills.length, 0) - priorKills };
      held.release();
      const startResult = await complete(starting);
      await complete(stopping);
      observe(`R1 ${action} during ${phase}`, { beforeRelease, startResult, priorChildren, oldEndChildren, oldChildrenExited: owner.children.slice(0, oldEndChildren).every(c => c.exitCode !== null) });
      expect(beforeRelease, 'cancel actual owner while held; await queued cleanup').toEqual({ aborted: true, finished: false, kills: 0 });
      expect(startResult, 'cancelled original operation must not publish ready').toEqual({ ok: false, reason: 'cancelled' });
      if (phase === 'index') expect(oldEndChildren, 'no old-generation late serve').toBe(priorChildren);
      expect(owner.children.slice(0, oldEndChildren).every(c => c.exitCode !== null), 'old owned handles exited').toBe(true);
    });
  }
});

it('R1: queued old enable cannot revive after disable followed by a newer enable', async () => {
  const owner = make(), view = make();
  await complete(owner.manager.enable()); await complete(view.manager.enable());
  const held = gate(); owner.hold.index = held;
  const active = owner.manager.rebuild(); await pumpUntil(() => held.entered);
  const obsolete = view.manager.enable();
  const disabling = view.manager.disable();
  const current = view.manager.enable();
  held.release();
  const [_, oldResult, __, newResult] = await complete(Promise.all([active, obsolete, disabling, current]));
  observe('R1 queued submission generation', { oldResult, newResult });
  expect(oldResult).toEqual({ ok: false, reason: 'cancelled' });
  expect(newResult).toEqual({ ok: true });
});

describe('R2: lane lifetime, stale cleanup and view eligibility', () => {
  for (const terminal of ['disable', 'shutdown'] as const) {
    it(`${terminal} releases owner for a real replacement start and retrieval`, async () => {
      const owner = make(), replacement = make();
      expect(await complete(owner.manager.enable())).toEqual({ ok: true });
      await complete(owner.manager[terminal]());
      expect(await complete(replacement.manager.enable())).toEqual({ ok: true });
      const result = await replacement.manager.getRetrievalClient().searchDetailed!('replacement read', 1);
      observe(`R2 ${terminal} replacement`, { status: result.status, newChildCount: replacement.children.length, newOwnerReadCount: replacement.calls.filter(c => c.stage === 'read').length });
      expect(result.status).toBe('ok');
      expect(replacement.calls.filter(c => c.stage === 'read')).toHaveLength(1);
    });
  }
  for (const terminal of ['disable', 'shutdown'] as const) {
    it(`${terminal} view stays ineligible after the shared owner becomes healthy again`, async () => {
      const owner = make(), view = make();
      await complete(owner.manager.enable()); await complete(view.manager.enable());
      await complete(view.manager[terminal]());
      await complete(owner.manager.enable());
      const before = owner.calls.filter(c => c.stage === 'read').length;
      const result = await view.manager.getRetrievalClient().searchDetailed!('ineligible view read', 1);
      observe(`R2 ${terminal} ineligible view`, { status: result.status, beforeReads: before, afterReads: owner.calls.filter(c => c.stage === 'read').length });
      expect(result.status).toBe('backend_unavailable');
      expect(owner.calls.filter(c => c.stage === 'read')).toHaveLength(before);
    });
  }
  it('a stale queued view stop cannot stop or query a replacement owner', async () => {
    const owner = make(), view = make(), replacement = make();
    await complete(owner.manager.enable()); await complete(view.manager.enable());
    const exit = gate(); owner.children[0].exitGate = exit;
    const ending = owner.manager.shutdown();
    await pumpUntil(() => exit.entered);
    const replacing = replacement.manager.enable();
    const staleStop = view.manager.disable();
    exit.release();
    await complete(Promise.all([ending, replacing, staleStop]));
    expect(replacement.children).toHaveLength(1);
    expect(replacement.children[0].kills).toHaveLength(0);
    expect((await replacement.manager.getRetrievalClient().searchDetailed!('current owner read', 1)).status).toBe('ok');
    expect((await view.manager.getRetrievalClient().searchDetailed!('stale view read', 1)).status).toBe('backend_unavailable');
  });
});

it('R3: a mutation after getStatus in the real stop/index gap reaches only the stable owner', async () => {
  const owner = make(), view = make();
  await complete(owner.manager.enable()); await complete(view.manager.enable());
  const held = gate(); owner.hold.index = held;
  expect(owner.manager.requestMemoryRefresh({ memoryDir: rootA, destructive: false })).toBe(true);
  await pumpUntil(() => held.entered);
  view.manager.getStatus();
  const accepted = view.manager.requestMemoryRefresh({ memoryDir: rootA, destructive: true });
  const a = owner.manager.getStatus().freshness, b = view.manager.getStatus().freshness;
  // Direct scheduler observation only disambiguates routing; operations remain real.
  const viewOwnRevision = (view.manager as unknown as { refreshScheduler: { getStatus(): { requestedRevision: number } } }).refreshScheduler.getStatus().requestedRevision;
  const cancelling = view.manager.disable();
  await turn(); const aborted = owner.calls.filter(c => c.stage === 'index').at(-1)?.signal?.aborted;
  held.release(); await complete(cancelling);
  observe('R3 actual stop/index gap', { accepted, ownerRevision: a.requestedRevision, viewOwnRevision, displayedRevision: b.requestedRevision, aborted });
  expect({ accepted, ownerRevision: a.requestedRevision, viewRevision: viewOwnRevision, displayedRevision: b.requestedRevision, aborted })
    .toEqual({ accepted: true, ownerRevision: 2, viewRevision: 0, displayedRevision: 2, aborted: true });
});

describe('R4: current configuration is checked inside actual start phases', () => {
  for (const field of ['root', 'binary', 'home'] as const) for (const phase of ['validation', 'index', 'health'] as const) {
    it(`${field} drift during held ${phase} blocks subsequent dispatch or ready`, async () => {
      const f = make(), held = gate(); f.hold[phase] = held;
      const starting = f.manager.enable(); await pumpUntil(() => held.entered);
      if (field === 'root') vi.stubEnv('MEMORY_VAULT_PATH', join(dir, 'vault-b'));
      if (field === 'binary') f.store.write({ executablePath: binaryB });
      if (field === 'home') vi.stubEnv('RHYTHM_ENGRAPH_HOME_DIR', join(dir, 'home-b'));
      held.release(); const result = await complete(starting);
      observe(`R4 ${field} during ${phase}`, { result, indexDispatches: f.calls.filter(c => c.stage === 'index').length, serveDispatches: f.children.length, oldHandlesExited: f.children.every(c => c.exitCode !== null) });
      expect(result.ok, 'drifted operation must not report success').toBe(false);
      if (phase === 'validation') expect(f.calls.filter(c => c.stage === 'index')).toHaveLength(0);
      if (phase === 'index') expect(f.children).toHaveLength(0);
      expect((await f.manager.getRetrievalClient().searchDetailed!('drifted read', 1)).status).toBe('backend_unavailable');
      expect(f.calls.filter(c => c.stage === 'read')).toHaveLength(0);
      expect(f.children.every(c => c.exitCode !== null), 'captured old handle is cleaned up').toBe(true);
    });
  }
  it('a queued old destructive callback cannot borrow the replacement binding', async () => {
    const f = make(), held = gate(); f.hold.index = held;
    const initial = f.manager.enable(); await pumpUntil(() => held.entered);
    expect(f.manager.requestMemoryRefresh({ memoryDir: rootA, destructive: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(250); await turn();
    vi.stubEnv('MEMORY_VAULT_PATH', join(dir, 'vault-b'));
    const rebuilding = f.manager.rebuild();
    expect(f.manager.requestMemoryRefresh({ memoryDir: rootB, destructive: false })).toBe(true);
    held.release(); await complete(Promise.all([initial, rebuilding]));
    observe('R4 queued destructive binding transfer', { newRootDestructiveDispatches: f.calls.filter(c => c.stage === 'index' && c.root === rootB && c.destructive).length });
    expect(f.calls.filter(c => c.stage === 'index' && c.root === rootB && c.destructive), 'only explicit B rebuild may transfer deletion intent').toHaveLength(1);
  });
  it('mutations arriving during explicit new-root rebuild survive as a follow-up', async () => {
    const f = make(); await complete(f.manager.enable());
    vi.stubEnv('MEMORY_VAULT_PATH', join(dir, 'vault-b'));
    const held = gate(); f.hold.index = held;
    const rebuilding = f.manager.rebuild(); await pumpUntil(() => held.entered);
    expect(f.manager.requestMemoryRefresh({ memoryDir: rootB, destructive: false })).toBe(true);
    const before = f.manager.getStatus().freshness;
    held.release(); await complete(rebuilding);
    await pumpUntil(() => f.manager.getStatus().freshness.appliedRevision === before.requestedRevision);
    observe('R4 new-root rebuild mutation follow-up', { before, after: f.manager.getStatus().freshness, newRootIndexes: f.calls.filter(c => c.stage === 'index' && c.root === rootB).length });
    expect(before.requestedRevision).toBeGreaterThan(before.appliedRevision);
    expect(f.calls.filter(c => c.stage === 'index' && c.root === rootB)).toHaveLength(2);
  });
});

describe('R5: idle and explicit rebuild read gating', () => {
  for (const field of ['root', 'binary', 'home'] as const) {
    it(`idle ${field} drift fails closed before another mutation`, async () => {
      const f = make(); await complete(f.manager.enable());
      if (field === 'root') vi.stubEnv('MEMORY_VAULT_PATH', join(dir, 'vault-b'));
      if (field === 'binary') f.store.write({ executablePath: binaryB });
      if (field === 'home') vi.stubEnv('RHYTHM_ENGRAPH_HOME_DIR', join(dir, 'home-b'));
      f.manager.getStatus();
      const result = await f.manager.getRetrievalClient().searchDetailed!('idle drift read', 1);
      observe(`R5 idle ${field}`, { status: result.status, reads: f.calls.filter(c => c.stage === 'read').length });
      expect(result.status).toBe('backend_unavailable');
      expect(f.calls.filter(c => c.stage === 'read')).toHaveLength(0);
    });
  }
  it('explicit rebuild synchronously gates the previously healthy endpoint', async () => {
    const f = make(); await complete(f.manager.enable());
    const held = gate(); f.hold.index = held;
    const rebuilding = f.manager.rebuild();
    const result = await f.manager.getRetrievalClient().searchDetailed!('submitted rebuild read', 1);
    await pumpUntil(() => held.entered); held.release(); await complete(rebuilding);
    observe('R5 submitted explicit rebuild', { status: result.status, reads: f.calls.filter(c => c.stage === 'read').length });
    expect(result.status).toBe('backend_unavailable');
    expect(f.calls.filter(c => c.stage === 'read')).toHaveLength(0);
  });
});
