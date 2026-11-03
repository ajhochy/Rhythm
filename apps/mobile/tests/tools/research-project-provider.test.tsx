/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import {
  RhythmToolsProvider,
  useRhythmTools,
} from '@/providers/rhythm-tools-provider';
import {
  RhythmToolsService,
  type ToolRequestInit,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/providers/opencode-provider', () => ({ useOpencode: () => ({}) }));
jest.mock('@/providers/paired-host-provider', () => ({ usePairedHost: () => ({}) }));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => ({}) }));

const BASE = '/mobile-gateway/tools/agent-research';
const TIME = '2026-10-06T00:00:00.000Z';

const mkProject = (id: string, extra: Record<string, unknown> = {}) => ({
  id, ownerUserId: 7, name: `Project ${id}`, question: `Question for ${id}?`, goals: [], domain: null, profileId: 'research',
  passConfig: [], modelPolicy: {}, criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 }, archivedAt: null,
  createdAt: TIME, updatedAt: TIME, ...extra,
});
const mkRun = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
  id, projectId, ownerUserId: 7, triggerType: 'manual', configSnapshot: {}, status: 'done', progress: { stages: [] },
  diagnostics: {}, startedAt: null, completedAt: null, createdAt: TIME, canonicalArtifact: null, artifacts: [], sources: [],
  usage: { tokens: 0, costUsd: 0 }, ...extra,
});
const stage = (role: string, status = 'done', extra: Record<string, unknown> = {}) => ({ id: `${role}-1`, role, status, ...extra });

type Call = { method: string; path: string; body?: any };
type Backend = {
  projects: any[];
  runs: Record<string, any[]>;
  markdown: string;
  calls: Call[];
  /** Return a value/promise to take over a request; undefined falls through to the built-in behavior. */
  handle?: (call: Call) => unknown;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function makeBackend(seed: Partial<Backend> = {}): Backend {
  return { projects: [], runs: {}, markdown: '# Report', calls: [], ...seed };
}

function makeService(backend: Backend, projectId = 'mac-project'): RhythmToolsService {
  const transport: ToolTransport = {
    async request<T>(path: string, init: ToolRequestInit): Promise<T> {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const call: Call = { method, path, body };
      backend.calls.push(call);
      const custom = backend.handle?.(call);
      if (custom !== undefined) return (await custom) as T;
      const [pathname] = path.split('?');
      const seg = pathname.slice(BASE.length).split('/').filter(Boolean); // projects, :id, runs, :runId, action
      const project = backend.projects.find((entry) => entry.id === seg[1]);
      const runs = backend.runs[seg[1]] ?? [];
      const found = runs.find((entry) => entry.id === seg[3]);
      if (seg[0] === 'projects' && seg.length === 1) {
        if (method === 'POST') {
          const created = mkProject('p-new', { ...body });
          backend.projects.push(created);
          return clone(created) as T;
        }
        return clone(backend.projects) as T;
      }
      if (seg.length === 2) {
        if (method === 'PATCH') {
          Object.assign(project, body);
          return clone(project) as T;
        }
        return clone(project) as T;
      }
      if (seg[2] === 'runs' && seg.length === 3) {
        if (method === 'POST') {
          const started = mkRun('r-started', seg[1], { status: 'running' });
          backend.runs[seg[1]] = [started, ...runs];
          return clone(started) as T;
        }
        return clone(runs) as T;
      }
      if (seg.length === 4) return clone(found) as T;
      if (seg[4] === 'export') return { markdown: backend.markdown } as T;
      if (seg[4] === 'cancel') found.status = 'canceled';
      if (seg[4] === 'resume') found.status = 'running';
      if (seg[4] === 'finish') found.status = 'running';
      return clone(found) as T;
    },
  };
  return new RhythmToolsService({ cloud: transport, paired: transport, projectId });
}

let tools!: ReturnType<typeof useRhythmTools>;
function Probe() {
  tools = useRhythmTools();
  return null;
}
const research = () => tools.research;

function tree(service: RhythmToolsService, scope: string, connected = true) {
  return (
    <RhythmToolsProvider
      cacheScope={scope}
      cloudAvailability="connected"
      pairedAvailability={connected ? 'connected' : 'network-failure'}
      service={service}>
      <Probe />
    </RhythmToolsProvider>
  );
}

const count = (backend: Backend, method: string, path: string) =>
  backend.calls.filter((call) => call.method === method && call.path === path).length;
const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
  });
};
const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
};

async function mountVisible(backend: Backend, scope = 'scope-a') {
  const view = render(tree(makeService(backend), scope));
  await act(async () => { research().setVisible(true); });
  await waitFor(() => expect(research().initialised).toBe(true));
  await waitFor(() => expect(research().loading).toBe(false));
  return view;
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Research workspace: selection, create and settings', () => {
  test('first selection is deterministic; the exact selection survives refresh/reorder; a vanished one is an explicit miss', async () => {
    const backend = makeBackend({
      projects: [mkProject('p1'), mkProject('p2')],
      runs: { p1: [mkRun('r-new', 'p1'), mkRun('r-old', 'p1')] },
    });
    await mountVisible(backend);
    await waitFor(() => expect(research().runDetail?.id).toBe('r-new'));
    expect(research().selectedProjectId).toBe('p1');
    expect(research().selectedRunId).toBe('r-new');

    await act(async () => { await research().selectRun('r-old'); });
    expect(research().selectedRunId).toBe('r-old');
    expect(research().runDetail?.id).toBe('r-old');

    // Reordered list on refresh: the exact prior selection is retained, never reset to the first/latest row.
    backend.runs.p1 = [mkRun('r-newer', 'p1'), mkRun('r-new', 'p1'), mkRun('r-old', 'p1')];
    await act(async () => { await research().refresh(); });
    expect(research().selectedRunId).toBe('r-old');
    expect(research().runs.map((run) => run.id)).toEqual(['r-newer', 'r-new', 'r-old']);

    // The selected run disappears: explicit missing selection, nothing substituted, no action target.
    backend.runs.p1 = [mkRun('r-newer', 'p1')];
    await act(async () => { await research().refresh(); });
    expect(research().missing).toBe('run');
    expect(research().selectedRunId).toBe('r-old');
    expect(research().runDetail).toBeNull();

    // Same for a vanished project.
    backend.projects = [mkProject('p2')];
    await act(async () => { await research().refresh(); });
    expect(research().missing).toBe('project');
    expect(research().selectedProjectId).toBe('p1');
    expect(research().runs).toEqual([]);
  });

  test('creating sends the exact canonical input, does not start a run, and selects only the new server id', async () => {
    const backend = makeBackend({ projects: [mkProject('p1')], runs: { p1: [] } });
    await mountVisible(backend);
    await act(async () => {
      await research().createProject({
        name: '  Garden  ', question: ' Why? ', goals: [' a ', '', 'b'], domain: '  ', modelPolicy: null,
        budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
      });
    });
    const post = backend.calls.find((call) => call.method === 'POST' && call.path === `${BASE}/projects`);
    expect(post?.body).toEqual({
      name: 'Garden', question: 'Why?', goals: ['a', 'b'], domain: null, profileId: 'research',
      passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy: {}, criticConfig: { enabled: true },
      synthesisConfig: { enabled: true }, scheduleRef: null,
      budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
    });
    expect(backend.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(false);
    expect(research().selectedProjectId).toBe('p-new');
    expect(research().projects.map((project) => project.id)).toEqual(['p1', 'p-new']);

    // Validation failures never reach the Mac.
    const before = backend.calls.length;
    const error = await reasonOf(research().createProject({
      name: '   ', question: 'q', goals: [], domain: '', modelPolicy: null,
      budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
    }));
    await flush();
    expect((error as Error).message).toMatch(/project name/i);
    expect(backend.calls.length).toBe(before);
    expect(research().actionError?.message).toMatch(/project name/i);
  });

  test('settings merge only dirty fields over a fresh canonical read, keeping zero and non-default limits and pinned models', async () => {
    const pinned = { providerId: 'gone', modelId: 'old-model' };
    const backend = makeBackend({
      projects: [mkProject('p1', {
        budget: { maxPasses: 2, maxTokens: 123_456, maxCostUsd: 2.5, maxWallClockMs: 90_000 },
        modelPolicy: { lead: { providerId: 'openai', modelId: 'gpt' }, researcher: pinned, extra: 'kept-by-server' },
      })],
      runs: { p1: [] },
    });
    await mountVisible(backend);

    await act(async () => { await research().saveSettings('p1', { budget: { maxPasses: 0 } }); });
    const patch = backend.calls.find((call) => call.method === 'PATCH');
    expect(patch?.path).toBe(`${BASE}/projects/p1`);
    expect(patch?.body).toEqual({
      budget: { maxPasses: 0, maxTokens: 123_456, maxCostUsd: 2.5, maxWallClockMs: 90_000 },
    });
    // Fresh canonical read BEFORE the save and a canonical reread after it.
    expect(count(backend, 'GET', `${BASE}/projects/p1`)).toBe(2);
    expect(research().projects[0].budget).toEqual({ maxPasses: 0, maxTokens: 123_456, maxCostUsd: 2.5, maxWallClockMs: 90_000 });

    backend.calls.length = 0;
    await act(async () => {
      await research().saveSettings('p1', { modelPolicy: { lead: { providerId: 'anthropic', modelId: 'claude' } } });
    });
    const modelPatch = backend.calls.find((call) => call.method === 'PATCH');
    // Both sides explicit; the untouched researcher side (an unavailable pinned model) is preserved exactly.
    expect(modelPatch?.body).toEqual({
      modelPolicy: { lead: { providerId: 'anthropic', modelId: 'claude' }, researcher: pinned },
    });
    expect(modelPatch?.body.budget).toBeUndefined();

    backend.calls.length = 0;
    const invalid = await reasonOf(research().saveSettings('p1', { budget: { maxTokens: 10 } }));
    expect(invalid).toBeInstanceOf(Error);
    expect(backend.calls).toHaveLength(0);
  });
});

describe('Research workspace: run actions and report', () => {
  const finishable = () => mkRun('r1', 'p1', { status: 'error', progress: { stages: [stage('researcher')] } });

  test('an action rereads the exact run and re-evaluates its predicate before any mutation is dispatched', async () => {
    const backend = makeBackend({ projects: [mkProject('p1')], runs: { p1: [finishable()] } });
    await mountVisible(backend);
    backend.calls.length = 0;

    await act(async () => { await research().runAction('p1', 'r1', 'finish'); });
    expect(backend.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${BASE}/projects/p1/runs/r1`,
      `POST ${BASE}/projects/p1/runs/r1/finish`,
    ]);

    // The run became active meanwhile: the fresh read blocks Finish, and no mutation is sent.
    backend.runs.p1 = [mkRun('r1', 'p1', { status: 'running', progress: { stages: [stage('researcher')] } })];
    backend.calls.length = 0;
    const error = await reasonOf(research().runAction('p1', 'r1', 'finish'));
    await flush();
    expect((error as Error).message).toMatch(/no longer be finished/);
    expect(backend.calls.map((call) => call.method)).toEqual(['GET']);
    expect(research().runs[0].status).toBe('running');
  });

  test('a rejected mutation rereads only the exact identity once, never retries, and rethrows the original error', async () => {
    const original = Object.assign(new Error('Run cannot be canceled'), { status: 409 });
    const backend = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [mkRun('r1', 'p1', { status: 'running' })] },
      handle: (call) => (call.method === 'POST' && call.path.endsWith('/cancel') ? Promise.reject(original) : undefined),
    });
    await mountVisible(backend);
    backend.calls.length = 0;

    const error = await reasonOf(research().runAction('p1', 'r1', 'cancel'));
    await flush();
    expect(error).toBe(original);
    expect(count(backend, 'POST', `${BASE}/projects/p1/runs/r1/cancel`)).toBe(1);
    expect(count(backend, 'GET', `${BASE}/projects/p1/runs/r1`)).toBe(2); // pre-mutation reread + one post-rejection reread
    expect(backend.calls.some((call) => call.path.includes('/runs') && call.method === 'POST' && !call.path.endsWith('/cancel'))).toBe(false);
    expect(research().actionError?.message).toBe('Run cannot be canceled');
    expect(Object.keys(research().pending)).toHaveLength(0);
  });

  test('the report is fetched only for a ready run (first done synthesis stage with a nonblank report)', async () => {
    const ready = mkRun('r-ready', 'p1', { progress: { stages: [stage('researcher'), stage('synthesis', 'done', { report: '# Done' })] } });
    const blank = mkRun('r-blank', 'p1', { progress: { stages: [stage('synthesis', 'done', { report: '  ' })] }, canonicalArtifact: { id: 'a' } });
    const backend = makeBackend({ projects: [mkProject('p1')], runs: { p1: [ready, blank] }, markdown: 'Ünï “q”\nline' });
    await mountVisible(backend);

    await act(async () => { await research().loadReport('p1', 'r-ready'); });
    expect(research().report).toEqual({ projectId: 'p1', runId: 'r-ready', markdown: 'Ünï “q”\nline' });

    await act(async () => { await research().selectRun('r-blank'); });
    expect(research().report).toBeNull(); // selection change clears the report
    const exportsBefore = backend.calls.filter((call) => call.path.includes('/export')).length;
    const error = await reasonOf(research().loadReport('p1', 'r-blank'));
    expect((error as Error).message).toMatch(/no final report/);
    expect(backend.calls.filter((call) => call.path.includes('/export')).length).toBe(exportsBefore);
  });

  test('a rejected export shows a bounded safe message and rethrows the original error', async () => {
    const original = Object.assign(new Error('Report is not ready'), { status: 409 });
    const done = mkRun('r1', 'p1', { progress: { stages: [stage('synthesis', 'done', { report: 'x' })] } });
    const backend = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [done] },
      handle: (call) => (call.path.includes('/export') ? Promise.reject(original) : undefined),
    });
    await mountVisible(backend);
    const error = await reasonOf(research().loadReport('p1', 'r1'));
    await flush();
    expect(error).toBe(original);
    expect(research().reportError).toBe('Report is not ready');
    expect(research().report).toBeNull();
  });

  test('starting rereads the project first, refuses archived projects, and creates no run for them', async () => {
    const backend = makeBackend({ projects: [mkProject('p1')], runs: { p1: [] } });
    await mountVisible(backend);
    backend.calls.length = 0;
    await act(async () => { await research().startRun('p1'); });
    expect(backend.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${BASE}/projects/p1`,
      `POST ${BASE}/projects/p1/runs`,
    ]);
    expect(backend.calls[1].body).toEqual({ triggerType: 'manual' });
    expect(research().selectedRunId).toBe('r-started');

    backend.projects = [mkProject('p1', { archivedAt: TIME })];
    backend.calls.length = 0;
    const error = await reasonOf(research().startRun('p1'));
    expect((error as Error).message).toMatch(/archived/i);
    expect(backend.calls.map((call) => call.method)).toEqual(['GET']);
  });
});

describe('Research workspace: request currency', () => {
  test('a scope/service change before a follow-up dispatch means the mutation is never sent', async () => {
    let releaseProject: (value: unknown) => void = () => undefined;
    let projectRead = false;
    const backendA = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [] },
      handle: (call) => {
        if (call.method === 'GET' && call.path === `${BASE}/projects/p1` && projectRead) {
          return new Promise((resolve) => { releaseProject = resolve; });
        }
        return undefined;
      },
    });
    const backendB = makeBackend({ projects: [mkProject('pB')], runs: { pB: [] } });
    const view = await mountVisible(backendA, 'scope-a');
    projectRead = true;
    const startA = research().startRun('p1');
    const settled = reasonOf(startA);
    await flush();

    view.rerender(tree(makeService(backendB), 'scope-b'));
    await waitFor(() => expect(research().projects.map((project) => project.id)).toEqual(['pB']));
    await act(async () => { releaseProject(clone(mkProject('p1'))); });
    await settled;
    await flush();

    expect(backendA.calls.some((call) => call.method === 'POST')).toBe(false);
    expect(backendB.calls.some((call) => call.method === 'POST')).toBe(false);
    expect(research().actionError).toBeNull();
    expect(research().runs).toEqual([]);
  });

  test('a response after dispatch cannot fill the replacement scope, clear its pending flag, or erase its error', async () => {
    let rejectStart: (reason: unknown) => void = () => undefined;
    const original = Object.assign(new Error('Start rejected'), { status: 409 });
    const backendA = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [] },
      handle: (call) => (call.method === 'POST' && call.path === `${BASE}/projects/p1/runs`
        ? new Promise((_, reject) => { rejectStart = reject; })
        : undefined),
    });
    const backendB = makeBackend({ projects: [mkProject('pB')], runs: { pB: [] } });
    const view = await mountVisible(backendA, 'scope-a');
    const settled = reasonOf(research().startRun('p1'));
    await waitFor(() => expect(backendA.calls.some((call) => call.method === 'POST')).toBe(true));

    view.rerender(tree(makeService(backendB), 'scope-b'));
    await waitFor(() => expect(research().projects.map((project) => project.id)).toEqual(['pB']));
    // A newer action in the replacement scope owns its own pending flag and error.
    let failB: (reason: unknown) => void = () => undefined;
    backendB.handle = (call) => (call.method === 'GET' && call.path === `${BASE}/projects/pB`
      ? new Promise((_, reject) => { failB = reject; })
      : undefined);
    const newer = reasonOf(research().startRun('pB'));
    await waitFor(() => expect(Object.keys(research().pending)).toEqual(['start:pB']));

    await act(async () => { rejectStart(original); });
    expect(await settled).toBe(original);
    await flush();
    expect(Object.keys(research().pending)).toEqual(['start:pB']); // the old rejection did not clear the newer flag
    expect(research().actionError).toBeNull(); // nor write its own error into the replacement scope

    const newerError = new Error('B failed');
    await act(async () => { failB(newerError); });
    expect(await newer).toBe(newerError);
    await flush();
    expect(research().actionError?.message).toBe('B failed');
  });

  test('a selection change invalidates a settings save that is still in flight', async () => {
    let releasePatch: (value: unknown) => void = () => undefined;
    const backend = makeBackend({
      projects: [mkProject('p1'), mkProject('p2')],
      runs: { p1: [], p2: [] },
      handle: (call) => (call.method === 'PATCH' ? new Promise((resolve) => { releasePatch = resolve; }) : undefined),
    });
    await mountVisible(backend);
    const settled = reasonOf(research().saveSettings('p1', { budget: { maxPasses: 1 } }));
    await waitFor(() => expect(backend.calls.some((call) => call.method === 'PATCH')).toBe(true));

    await act(async () => { await research().selectProject('p2'); });
    const before = research().projects.find((project) => project.id === 'p1');
    await act(async () => { releasePatch(clone(mkProject('p1', { budget: { maxPasses: 1, maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1 } }))); });
    await settled;
    expect(research().selectedProjectId).toBe('p2');
    expect(research().projects.find((project) => project.id === 'p1')).toEqual(before);
  });
});

describe('Research workspace: connection currency, budget validation and read frames (correction)', () => {
  const mountSame = async (backend: Backend) => {
    const service = makeService(backend);
    const view = render(tree(service, 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    return { service, view };
  };

  test.each(['start', 'save'] as const)(
    'a connection lost while the %s preflight read is pending rejects the follow-up mutation',
    async (kind) => {
      let release!: (value: unknown) => void;
      let defer = false;
      const backend = makeBackend({
        projects: [mkProject('p1')],
        runs: { p1: [] },
        handle: (call) => (defer && call.method === 'GET' && call.path === `${BASE}/projects/p1`
          ? new Promise((resolve) => { release = resolve; })
          : undefined),
      });
      const { service, view } = await mountSame(backend);
      defer = true;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = reasonOf(kind === 'start'
          ? research().startRun('p1')
          : research().saveSettings('p1', { budget: { maxPasses: 1 } }));
        await Promise.resolve();
      });
      expect(typeof release).toBe('function');
      view.rerender(tree(service, 'scope-a', false));
      await flush();
      await act(async () => { release(clone(mkProject('p1'))); await pending; });
      expect(backend.calls.filter((call) => call.method === 'POST' || call.method === 'PATCH')).toEqual([]);
    },
  );

  test('a missing untouched budget limit fails visibly with zero PATCH, and a deliberate repair is allowed', async () => {
    const backend = makeBackend({
      projects: [mkProject('p1', { budget: { maxPasses: 2, maxCostUsd: 1, maxWallClockMs: 90_000 } })],
      runs: { p1: [] },
    });
    await mountVisible(backend);
    const error = await reasonOf(research().saveSettings('p1', { budget: { maxCostUsd: 2 } }));
    await flush();
    expect((error as Error).message).toMatch(/token limit is missing or invalid/i);
    expect(research().actionError?.message).toMatch(/token limit/i);
    expect(backend.calls.filter((call) => call.method === 'PATCH')).toEqual([]);

    await act(async () => {
      await research().saveSettings('p1', { budget: { maxCostUsd: 2, maxTokens: 6_000_000 } });
    });
    const patch = backend.calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      budget: { maxPasses: 2, maxTokens: 6_000_000, maxCostUsd: 2, maxWallClockMs: 90_000 },
    });
  });

  test('a malformed untouched budget limit also fails without a PATCH', async () => {
    const backend = makeBackend({
      projects: [mkProject('p1', { budget: { maxPasses: '3', maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 } })],
      runs: { p1: [] },
    });
    await mountVisible(backend);
    const error = await reasonOf(research().saveSettings('p1', { budget: { maxCostUsd: 2 } }));
    expect((error as Error).message).toMatch(/passes limit is missing or invalid/i);
    expect(backend.calls.filter((call) => call.method === 'PATCH')).toEqual([]);
  });

  test('backgrounding the app revokes a pending poll frame: its result is discarded', async () => {
    jest.useFakeTimers();
    const handlers: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    }) as never);
    let release!: (value: unknown) => void;
    let defer = false;
    const backend = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [mkRun('r1', 'p1', { status: 'running' })] },
      handle: (call) => (defer && call.method === 'GET' && call.path === `${BASE}/projects/p1/runs`
        ? new Promise((resolve) => { release = resolve; })
        : undefined),
    });
    render(tree(makeService(backend), 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    defer = true;
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(typeof release).toBe('function');
    await act(async () => { handlers.forEach((handler) => handler('background')); });
    await act(async () => { release(clone([mkRun('r1', 'p1', { status: 'done' })])); });
    await flush();
    expect(research().runDetail?.status).toBe('running');
  });
});

describe('Research workspace: older gateways, errors and offline', () => {
  const statusError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), { status, code, ...extra });

  test('the exact older-gateway project-list rejection becomes workflow-unavailable, without a mutation probe', async () => {
    const backend = makeBackend({
      handle: () => Promise.reject(statusError(404, 'NOT_FOUND', 'ResearchJob not found')),
    });
    await mountVisible(backend);
    expect(research().unavailable).toBe(true);
    expect(research().error).toBeNull();
    expect(research().canMutate).toBe(false);
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(backend.calls).toHaveLength(1); // no endpoint scan
  });

  test('projects list succeeds but the runs read is the exact operation rejection: unavailable, projects and scope retained', async () => {
    const backend = makeBackend({
      projects: [mkProject('p1')],
      handle: (call) => (call.path === `${BASE}/projects/p1/runs`
        ? Promise.reject(statusError(404, 'NOT_FOUND', 'MobileToolOperation not found'))
        : undefined),
    });
    await mountVisible(backend);
    await waitFor(() => expect(research().unavailable).toBe(true));
    expect(research().projects.map((project) => project.id)).toEqual(['p1']);
    expect(research().canMutate).toBe(false);
  });

  test.each([
    ['not-found', statusError(404, 'NOT_FOUND', 'ResearchProject not found')],
    ['auth', statusError(401, 'UNAUTHORIZED', 'Pairing expired')],
    ['forbidden', statusError(403, 'FORBIDDEN', 'Not allowed')],
    ['network', statusError(0, 'NETWORK_ERROR', 'Network down', { retryable: true })],
  ])('a genuine %s failure keeps its own meaning and is not unavailable', async (kind, error) => {
    const backend = makeBackend({ handle: () => Promise.reject(error) });
    await mountVisible(backend);
    expect(research().unavailable).toBe(false);
    expect(research().error?.kind).toBe(kind);
  });

  test('offline shows read-only state and refuses mutations without any request', async () => {
    const backend = makeBackend({ projects: [mkProject('p1')], runs: { p1: [mkRun('r1', 'p1')] } });
    const view = await mountVisible(backend);
    view.rerender(tree(makeService(backend), 'scope-a', false));
    await waitFor(() => expect(research().canMutate).toBe(false));
    await act(async () => { await research().refresh(); });
    expect(research().offline).toBe(true);
    expect(research().projects.map((project) => project.id)).toEqual(['p1']);
    backend.calls.length = 0;
    const error = await reasonOf(research().startRun('p1'));
    expect((error as Error).message).toMatch(/read-only/i);
    expect(backend.calls).toHaveLength(0);
  });
});

describe('Research workspace: active-run updates', () => {
  const runningBackend = () => makeBackend({
    projects: [mkProject('p1')],
    runs: { p1: [mkRun('r1', 'p1', { status: 'running' })] },
  });
  const listCalls = (backend: Backend) => count(backend, 'GET', `${BASE}/projects/p1/runs`);
  const advance = async (ms: number) => {
    await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  };

  test('one 5000ms read at a time while visible with an active run, and it stops at a terminal state', async () => {
    jest.useFakeTimers();
    const backend = runningBackend();
    render(tree(makeService(backend), 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    expect(research().runs).toHaveLength(1);
    const initial = listCalls(backend);

    await advance(4_999);
    expect(listCalls(backend)).toBe(initial);
    await advance(1);
    await flush();
    expect(listCalls(backend)).toBe(initial + 1);

    backend.runs.p1[0].status = 'done';
    await advance(5_000);
    await flush();
    expect(listCalls(backend)).toBe(initial + 2);
    expect(research().runs[0].status).toBe('done');

    await advance(30_000); // terminal: no further timer
    expect(listCalls(backend)).toBe(initial + 2);
  });

  test('no updates while hidden, backgrounded or offline; they resume when allowed again', async () => {
    jest.useFakeTimers();
    const handlers: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    }) as never);
    const backend = runningBackend();
    const view = render(tree(makeService(backend), 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    const initial = listCalls(backend);

    await act(async () => { research().setVisible(false); });
    await advance(20_000);
    expect(listCalls(backend)).toBe(initial);

    await act(async () => { handlers.forEach((handler) => handler('background')); });
    await act(async () => { research().setVisible(true); });
    await flush();
    const afterVisible = listCalls(backend); // the visible one-shot refresh only
    await advance(20_000);
    expect(listCalls(backend)).toBe(afterVisible);

    await act(async () => { handlers.forEach((handler) => handler('active')); });
    await advance(5_000);
    await flush();
    expect(listCalls(backend)).toBe(afterVisible + 1);

    view.rerender(tree(makeService(backend), 'scope-a', false));
    await flush();
    const offlineBase = listCalls(backend);
    await advance(20_000);
    expect(listCalls(backend)).toBe(offlineBase);
  });

  test('an obsolete poll cannot write into a replacement scope', async () => {
    jest.useFakeTimers();
    let releasePoll: (value: unknown) => void = () => undefined;
    let deferPoll = false;
    const backendA = makeBackend({
      projects: [mkProject('p1')],
      runs: { p1: [mkRun('r1', 'p1', { status: 'running' })] },
      handle: (call) => (deferPoll && call.method === 'GET' && call.path === `${BASE}/projects/p1/runs`
        ? new Promise((resolve) => { releasePoll = resolve; })
        : undefined),
    });
    const backendB = makeBackend({ projects: [mkProject('pB')], runs: { pB: [mkRun('rB', 'pB', { status: 'done' })] } });
    const view = render(tree(makeService(backendA), 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    deferPoll = true;
    await advance(5_000);
    await flush();

    view.rerender(tree(makeService(backendB), 'scope-b'));
    await flush();
    await act(async () => { releasePoll(clone([mkRun('r1', 'p1', { status: 'done' })])); });
    await flush();
    expect(research().projects.map((project) => project.id)).toEqual(['pB']);
    expect(research().runs.map((run) => run.id)).toEqual(['rB']);
  });
});
