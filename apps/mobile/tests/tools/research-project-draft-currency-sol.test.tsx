/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ResearchProjectWorkspace } from '@/components/tools/research-project-workspace';
import { Colors } from '@/constants/theme';
import type { ResearchWorkspace } from '@/providers/rhythm-tools-provider';
import type { ModelOption } from '@/providers/opencode-provider-utils';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
}));

const TIME = '2026-10-06T00:00:00.000Z';
const project = (id: string, extra: Record<string, unknown> = {}): any => ({
  id, ownerUserId: 7, name: `Project ${id}`, question: `Question for ${id}?`, goals: [], domain: null, profileId: 'research',
  passConfig: [], modelPolicy: {}, criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 }, archivedAt: null,
  createdAt: TIME, updatedAt: TIME, ...extra,
});
const run = (id: string, extra: Record<string, unknown> = {}): any => ({
  id, projectId: 'p1', ownerUserId: 7, triggerType: 'manual', configSnapshot: {}, status: 'done', progress: { stages: [] },
  diagnostics: {}, startedAt: TIME, completedAt: null, createdAt: TIME, canonicalArtifact: null, artifacts: [], sources: [],
  usage: { tokens: 1200, costUsd: 0.5 }, ...extra,
});
const stage = (role: string, status = 'done', extra: Record<string, unknown> = {}) => ({ id: `${role}-1`, role, status, ...extra });

const models: ModelOption[] = [
  { id: 'openai/gpt', label: 'GPT', providerID: 'openai', providerLabel: 'OpenAI', modelID: 'gpt', supportsReasoning: true, supportsAttachments: false, inputModalities: ['text'], supportsToolCalls: true },
  { id: 'anthropic/claude', label: 'Claude', providerID: 'anthropic', providerLabel: 'Anthropic', modelID: 'claude', supportsReasoning: true, supportsAttachments: false, inputModalities: ['text'], supportsToolCalls: true },
];

function makeWorkspace(overrides: Partial<ResearchWorkspace> = {}): ResearchWorkspace {
  return {
    initialised: true, loading: false, offline: false, unavailable: false, error: null, actionError: null,
    projects: [project('p1')], selectedProjectId: 'p1', runs: [], selectedRunId: null, runDetail: null, missing: null,
    report: null, reportError: null, pending: {}, scope: 'scope-a', canMutate: true,
    refresh: jest.fn().mockResolvedValue(undefined),
    selectProject: jest.fn().mockResolvedValue(undefined),
    selectRun: jest.fn().mockResolvedValue(undefined),
    closeReport: jest.fn(),
    createProject: jest.fn().mockResolvedValue(undefined),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    startRun: jest.fn().mockResolvedValue(undefined),
    runAction: jest.fn().mockResolvedValue(undefined),
    loadReport: jest.fn().mockResolvedValue(undefined),
    setVisible: jest.fn(),
    ...overrides,
  };
}

const tree = (workspace: ResearchWorkspace) => (
  <PaperProvider>
    <ResearchProjectWorkspace models={models} palette={Colors.light} workspace={workspace} />
  </PaperProvider>
);
const show = (overrides: Partial<ResearchWorkspace> = {}) => {
  const workspace = makeWorkspace(overrides);
  return { workspace, ...render(tree(workspace)) };
};
const disabled = (node: any) => Boolean(node.props.accessibilityState?.disabled);

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('Sol: stale settings completion must preserve a newer project draft and open dialog', async () => {
  let release!: () => void;
  const saveOld = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const first = makeWorkspace({ projects: [project('p1'), project('p2')], saveSettings: saveOld });
  const screen = render(tree(first));
  fireEvent.press(screen.getByLabelText('Edit research settings'));
  fireEvent.changeText(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit'), '777777');
  fireEvent.press(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Save research settings'));
  expect(saveOld).toHaveBeenCalledWith('p1', { budget: { maxTokens: 777777 } });
  const second = { ...first, selectedProjectId: 'p2' };
  screen.rerender(tree(second));
  await waitFor(() => expect(screen.queryByTestId('research-settings-dialog-surface')).toBeNull());
  fireEvent.press(screen.getByLabelText('Edit research settings'));
  fireEvent.changeText(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit'), '888888');
  expect(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit').props.value).toBe('888888');
  await act(async () => { release(); await Promise.resolve(); });
  expect(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit').props.value).toBe('888888');
  expect(screen.getByLabelText('Save research settings')).toBeTruthy();
});
