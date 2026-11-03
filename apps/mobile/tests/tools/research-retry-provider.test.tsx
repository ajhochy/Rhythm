import { act, cleanup, render, waitFor } from '@testing-library/react-native';

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
// Only imported by the app wrapper in the provider module; the tests below render the real RhythmToolsProvider.
jest.mock('@/providers/opencode-provider', () => ({ useOpencode: () => ({}) }));
jest.mock('@/providers/paired-host-provider', () => ({ usePairedHost: () => ({}) }));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => ({}) }));

const LIST = '/mobile-gateway/tools/agent-research';
const ITEM = (id: string) => `${LIST}/${id}`;
const RETRY = (id: string) => `${LIST}/${id}/retry`;

type Call = { path: string; method: string };

function makeTransport(handler: (call: Call) => Promise<unknown>) {
  const calls: Call[] = [];
  const transport: ToolTransport = {
    async request<T>(path: string, init: ToolRequestInit): Promise<T> {
      const call = { path, method: init?.method ?? 'GET' };
      calls.push(call);
      return handler(call) as Promise<T>;
    },
  };
  return { calls, transport };
}

function makeService(transport: ToolTransport, projectId = 'project-a') {
  return new RhythmToolsService({ cloud: transport, paired: transport, projectId });
}

let tools!: ReturnType<typeof useRhythmTools>;
function Probe() {
  tools = useRhythmTools();
  return null;
}

function tree(service: RhythmToolsService, cacheScope: string) {
  return (
    <RhythmToolsProvider
      cacheScope={cacheScope}
      cloudAvailability="connected"
      pairedAvailability="connected"
      service={service}>
      <Probe />
    </RhythmToolsProvider>
  );
}

const rows = [
  { id: 'job-1', query: 'first job', status: 'error', canRetry: true },
  { id: 'job-2', query: 'second job', status: 'error', canRetry: true },
];
const items = () => tools.getState('research').items;
const row = (id: string) => items().find((item) => item.id === id);
const count = (calls: Call[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path).length;

describe('explicit Research retry rejection', () => {
  afterEach(cleanup);

  async function mountWithRows(handler: (call: Call) => Promise<unknown>) {
    const { calls, transport } = makeTransport(async (call) => {
      if (call.method === 'GET' && call.path === LIST) return rows;
      return handler(call);
    });
    const view = render(tree(makeService(transport), 'scope-a'));
    await act(async () => { await tools.refresh('research'); });
    await waitFor(() => expect(items()).toHaveLength(2));
    return { calls, transport, view };
  }

  test('rereads exactly the submitted job once, updates only its row, never redispatches, and rethrows the original error', async () => {
    const original = Object.assign(new Error('Retry was rejected'), { status: 400 });
    const { calls } = await mountWithRows(async (call) => {
      if (call.method === 'POST' && call.path === RETRY('job-1')) throw original;
      if (call.method === 'GET' && call.path === ITEM('job-1')) {
        return { id: 'job-1', query: 'first job', status: 'error', canRetry: false, token: 'never-cache' };
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const listCallsBefore = count(calls, 'GET', LIST);

    let thrown: unknown;
    await act(async () => {
      try { await tools.perform('research', 'research:retry', { id: 'job-1' }); } catch (error) { thrown = error; }
    });

    expect(thrown).toBe(original);
    expect(count(calls, 'POST', RETRY('job-1'))).toBe(1);
    expect(count(calls, 'GET', ITEM('job-1'))).toBe(1);
    expect(calls.some((call) => call.path.includes('job-2'))).toBe(false);
    expect(count(calls, 'GET', LIST)).toBe(listCallsBefore);
    await waitFor(() => expect(row('job-1')?.canRetry).toBe(false));
    expect('token' in (row('job-1') ?? {})).toBe(false);
    expect(row('job-2')).toEqual(expect.objectContaining({ canRetry: true, query: 'second job' }));
    expect(items()).toHaveLength(2);
  });

  test('a failed reread still rethrows the very same action error and leaves rows unchanged', async () => {
    const original = Object.assign(new Error('Retry was rejected'), { status: 400 });
    const { calls } = await mountWithRows(async (call) => {
      if (call.method === 'POST' && call.path === RETRY('job-1')) throw original;
      if (call.method === 'GET' && call.path === ITEM('job-1')) throw new Error('reread failed');
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });

    let thrown: unknown;
    await act(async () => {
      try { await tools.perform('research', 'research:retry', { id: 'job-1' }); } catch (error) { thrown = error; }
    });

    expect(thrown).toBe(original);
    expect(count(calls, 'GET', ITEM('job-1'))).toBe(1);
    expect(count(calls, 'POST', RETRY('job-1'))).toBe(1);
    expect(row('job-1')).toEqual(expect.objectContaining({ canRetry: true }));
  });

  test('a successful retry keeps the existing refresh path and does not take the reread path', async () => {
    const { calls } = await mountWithRows(async (call) => {
      if (call.method === 'POST' && call.path === RETRY('job-1')) return { id: 'job-1', query: 'first job', status: 'running' };
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    await act(async () => { await tools.perform('research', 'research:retry', { id: 'job-1' }); });
    expect(count(calls, 'GET', ITEM('job-1'))).toBe(0);
    expect(count(calls, 'GET', LIST)).toBe(2);
  });

  test('a reread that resolves after the service/cache scope was replaced cannot update the replacement', async () => {
    const original = Object.assign(new Error('Retry was rejected'), { status: 400 });
    let finishReread: (value: unknown) => void = () => undefined;
    let rereadStarted = false;
    const { transport: transportA } = makeTransport(async (call) => {
      if (call.method === 'GET' && call.path === LIST) return rows;
      if (call.method === 'POST' && call.path === RETRY('job-1')) throw original;
      if (call.method === 'GET' && call.path === ITEM('job-1')) {
        rereadStarted = true;
        return new Promise((resolve) => { finishReread = resolve; });
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const { calls: callsB, transport: transportB } = makeTransport(async (call) => {
      if (call.method === 'GET' && call.path === LIST) {
        return [{ id: 'job-1', query: 'replacement account job', status: 'error', canRetry: true }];
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });

    const view = render(tree(makeService(transportA, 'project-a'), 'scope-a'));
    await act(async () => { await tools.refresh('research'); });
    await waitFor(() => expect(items()).toHaveLength(2));
    const performA = tools.perform;

    let thrown: unknown;
    let pending!: Promise<void>;
    await act(async () => {
      pending = performA('research', 'research:retry', { id: 'job-1' }).then(
        () => undefined,
        (error) => { thrown = error; },
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(rereadStarted).toBe(true));

    // The user's service, project and cache scope are replaced while the reread is still in flight.
    view.rerender(tree(makeService(transportB, 'project-b'), 'scope-b'));
    await act(async () => { await tools.refresh('research'); });
    await waitFor(() => expect(row('job-1')?.query).toBe('replacement account job'));

    await act(async () => {
      finishReread({ id: 'job-1', query: 'first job', status: 'error', canRetry: false });
      await pending;
    });

    expect(thrown).toBe(original);
    expect(row('job-1')).toEqual(expect.objectContaining({ query: 'replacement account job', canRetry: true }));
    expect(callsB.some((call) => call.path === ITEM('job-1'))).toBe(false);
  });
});
