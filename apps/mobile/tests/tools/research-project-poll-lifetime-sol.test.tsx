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

describe('Sol: Research B correction poll lifetime', () => {
  test('disconnect/reconnect must keep the pending read exclusive and resume after it settles', async () => {
    jest.useFakeTimers();
    const releases: ((value: unknown) => void)[] = [];
    let defer = false;
    let pendingReads = 0;
    let peakPending = 0;
    const backend = makeBackend({
      projects: [mkProject('p1')], runs: { p1: [mkRun('r1', 'p1', { status: 'running' })] },
      handle: (call) => {
        if (!defer || call.method !== 'GET' || call.path !== `${BASE}/projects/p1/runs`) return undefined;
        pendingReads += 1;
        peakPending = Math.max(peakPending, pendingReads);
        return new Promise((resolve) => {
          releases.push((value) => { pendingReads -= 1; resolve(value); });
        });
      },
    });
    const sameService = makeService(backend);
    const view = render(tree(sameService, 'scope-a'));
    await act(async () => { research().setVisible(true); });
    await flush();
    defer = true;
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(pendingReads).toBe(1);
    view.rerender(tree(sameService, 'scope-a', false));
    await flush();
    view.rerender(tree(sameService, 'scope-a', true));
    await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    await flush();
    // Count actual transport reads, including the reconnect refresh: invalidating a frame does not settle its I/O.
    expect(peakPending).toBe(1);
    expect(pendingReads).toBe(1);
    const beforeSettled = releases.length;
    await act(async () => { releases[0](clone([mkRun('r1', 'p1', { status: 'running' })])); });
    await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(releases.length).toBe(beforeSettled + 1);
    expect(pendingReads).toBe(1);
    expect(peakPending).toBe(1);
    await act(async () => { releases[releases.length - 1](clone([mkRun('r1', 'p1', { status: 'running' })])); });
    await flush();
  });
});
