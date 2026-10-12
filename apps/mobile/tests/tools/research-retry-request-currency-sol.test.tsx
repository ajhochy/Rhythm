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

describe('Sol: original retry request currency', () => {
  afterEach(cleanup);
  test('a pending POST cannot rebase onto the same service with a replacement cache scope', async () => {
    const original = Object.assign(new Error('original scoped retry rejection'), { status: 400 });
    let rejectPost!: (reason: unknown) => void;
    let postStarted = false;
    let currentRows = rows;
    const { calls, transport } = makeTransport(async (call) => {
      if (call.method === 'GET' && call.path === LIST) return currentRows;
      if (call.method === 'POST' && call.path === RETRY('job-1')) {
        postStarted = true;
        return new Promise((_resolve, reject) => { rejectPost = reject; });
      }
      if (call.method === 'GET' && call.path === ITEM('job-1')) {
        return { id: 'job-1', query: 'old request follow-up', status: 'error', canRetry: false };
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const sameService = makeService(transport);
    const view = render(tree(sameService, 'scope-a'));
    await act(async () => { await tools.refresh('research'); });
    const performA = tools.perform;
    let thrown: unknown;
    let pending!: Promise<void>;
    await act(async () => {
      pending = performA('research', 'research:retry', { id: 'job-1' }).then(
        () => undefined, (error) => { thrown = error; },
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(postStarted).toBe(true));
    currentRows = [{ id: 'job-1', query: 'replacement scoped row', status: 'error', canRetry: true }];
    view.rerender(tree(sameService, 'scope-b'));
    await act(async () => { await tools.refresh('research'); });
    await waitFor(() => expect(row('job-1')?.query).toBe('replacement scoped row'));
    await act(async () => { rejectPost(original); await pending; });
    expect(thrown).toBe(original);
    expect(count(calls, 'POST', RETRY('job-1'))).toBe(1);
    expect(count(calls, 'GET', ITEM('job-1'))).toBe(0);
    expect(row('job-1')).toEqual(expect.objectContaining({ query: 'replacement scoped row', canRetry: true }));
  });
  test('replacement scoped row must survive a delayed old POST rejection', async () => {
    const original = Object.assign(new Error('original scoped retry rejection'), { status: 400 });
    let rejectPost!: (reason: unknown) => void;
    let postStarted = false;
    let currentRows = rows;
    const { calls, transport } = makeTransport(async (call) => {
      if (call.method === 'GET' && call.path === LIST) return currentRows;
      if (call.method === 'POST' && call.path === RETRY('job-1')) {
        postStarted = true;
        return new Promise((_resolve, reject) => { rejectPost = reject; });
      }
      if (call.method === 'GET' && call.path === ITEM('job-1')) {
        return { id: 'job-1', query: 'old request follow-up', status: 'error', canRetry: false };
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const sameService = makeService(transport);
    const view = render(tree(sameService, 'scope-a'));
    await act(async () => { await tools.refresh('research'); });
    const performA = tools.perform;
    let thrown: unknown;
    let pending!: Promise<void>;
    await act(async () => {
      pending = performA('research', 'research:retry', { id: 'job-1' }).then(
        () => undefined, (error) => { thrown = error; },
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(postStarted).toBe(true));
    currentRows = [{ id: 'job-1', query: 'replacement scoped row', status: 'error', canRetry: true }];
    view.rerender(tree(sameService, 'scope-b'));
    await act(async () => { await tools.refresh('research'); });
    await waitFor(() => expect(row('job-1')?.query).toBe('replacement scoped row'));
    await act(async () => { rejectPost(original); await pending; });
    expect(thrown).toBe(original);
    expect(count(calls, 'POST', RETRY('job-1'))).toBe(1);
    expect(row('job-1')).toEqual(expect.objectContaining({ query: 'replacement scoped row', canRetry: true }));
    expect(count(calls, 'GET', ITEM('job-1'))).toBe(0);
  });
});
