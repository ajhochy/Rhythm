/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanupAsync, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { Dialog, PaperProvider } from 'react-native-paper';

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

// Execution fixture: RNTL's synchronous cleanup() starts its registered asynchronous unmount without awaiting it, so a second
// render/act in the same test raced it. The installed RNTL's own teardown awaits cleanupAsync; do the same between renders.
const reset = async () => {
  await cleanupAsync();
};
// Paper can retain a closing animation's surface in Jest. Assert its public closed/noninteractive contract instead of
// requiring animation teardown: the exact real Dialog is closed, and its modal host is absent or cannot receive touches.
const dialogClosed = (
  screen: Pick<ReturnType<typeof render>, 'queryByTestId' | 'UNSAFE_getAllByType'>,
  surfaceId: string,
) => {
  const dialogId = surfaceId.replace(/-surface$/, '');
  return waitFor(() => {
    const dialog = screen.UNSAFE_getAllByType(Dialog).find((node) => node.props.testID === dialogId);
    expect(dialog?.props.visible).toBe(false);
    const host = screen.queryByTestId(dialogId);
    if (host) expect(host.props.pointerEvents).toBe('none');
  });
};

afterEach(async () => {
  await reset();
  jest.restoreAllMocks();
});

describe('ResearchProjectWorkspace presentation', () => {
  test('project cards are compact with bounded lines while the selected detail keeps the full question', () => {
    const long = 'A very long research question that goes on and on '.repeat(12).trim();
    const screen = show({
      projects: [project('p1', { name: 'N'.repeat(120), question: long }), project('p2', { name: 'Short', question: 'Tiny?' })],
    });
    const card = screen.getByTestId('research-project-card-p1');
    const title = within(card).getByText('N'.repeat(120));
    expect(title.props.numberOfLines).toBe(1);
    expect(within(card).getByText(long).props.numberOfLines).toBe(2);
    // Full text stays reachable in the detail (no line cap).
    const detail = screen.getByTestId('research-project-detail');
    expect(within(detail).getByText(long).props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('research-project-card-p2')).toBeTruthy();
    // Selecting another card is an explicit provider call; nothing else is selected silently.
    fireEvent.press(screen.getByTestId('research-project-card-p2'));
    expect(screen.workspace.selectProject).toHaveBeenCalledWith('p2');
  });

  test('current and prior runs are listed and the exact pressed run is selected', () => {
    const runs = [run('r-current', { status: 'running' }), run('r-prior')];
    const screen = show({ runs, selectedRunId: 'r-current', runDetail: runs[0] });
    expect(screen.getByTestId('research-run-r-current')).toBeTruthy();
    expect(screen.getByTestId('research-run-r-prior')).toBeTruthy();
    fireEvent.press(screen.getByTestId('research-run-r-prior'));
    expect(screen.workspace.selectRun).toHaveBeenCalledWith('r-prior');
  });

  test('missing selections are explicit and never substitute another project or run', async () => {
    const missingRun = show({ missing: 'run', selectedRunId: 'gone', runs: [run('other')], runDetail: null });
    expect(missingRun.getByTestId('research-run-missing')).toBeTruthy();
    expect(missingRun.queryByTestId('research-run-detail')).toBeNull();
    await reset();
    const missingProject = show({ missing: 'project', selectedProjectId: 'gone', projects: [project('p9')] });
    expect(missingProject.getByTestId('research-project-missing')).toBeTruthy();
    expect(missingProject.queryByTestId('research-project-detail')).toBeNull();
  });

  test('unavailable and error states are distinct, honest and keep creation disabled', async () => {
    const unavailable = show({ unavailable: true, canMutate: false, projects: [] });
    expect(unavailable.getByTestId('research-workflow-unavailable')).toBeTruthy();
    expect(unavailable.getByText(/legacy research jobs below still work/i)).toBeTruthy();
    expect(disabled(unavailable.getByLabelText('New research project'))).toBe(true);
    await reset();
    const forbidden = show({ error: { kind: 'forbidden', message: 'Blocked by pairing policy' }, projects: [] });
    expect(forbidden.getByText('Blocked by pairing policy')).toBeTruthy();
    expect(forbidden.queryByTestId('research-workflow-unavailable')).toBeNull();
  });

  test('offline cached data is read-only: no action can be started', () => {
    const runs = [run('r1', { status: 'error', progress: { stages: [stage('researcher')] } })];
    const screen = show({ canMutate: false, offline: true, runs, selectedRunId: 'r1', runDetail: runs[0] });
    expect(screen.getByTestId('research-workspace-offline')).toBeTruthy();
    for (const label of ['Start run', 'Edit research settings', 'Resume run', 'Finish with current evidence', 'View report', 'New research project']) {
      const node = screen.queryByLabelText(label);
      if (node) expect(disabled(node)).toBe(true);
    }
  });
});

describe('ResearchProjectWorkspace run actions and report', () => {
  const withRun = (status: string, stages: any[], diagnostics: Record<string, unknown> = {}, pending: Record<string, number> = {}) => {
    const selected = run('r1', { status, progress: { stages }, diagnostics });
    return show({ runs: [selected], selectedRunId: 'r1', runDetail: selected, pending });
  };

  test('active runs offer Cancel only', () => {
    const screen = withRun('running', [stage('researcher', 'running')]);
    expect(screen.getByLabelText('Cancel run')).toBeTruthy();
    expect(screen.queryByLabelText('Resume run')).toBeNull();
    expect(screen.queryByLabelText('Finish with current evidence')).toBeNull();
    fireEvent.press(screen.getByLabelText('Cancel run'));
    expect(screen.workspace.runAction).toHaveBeenCalledWith('p1', 'r1', 'cancel');
  });

  test('an errored run with evidence offers Resume and Finish; a no-evidence stop offers neither Finish nor a report', async () => {
    const errored = withRun('error', [stage('plan'), stage('researcher')]);
    expect(disabled(errored.getByLabelText('Resume run'))).toBe(false);
    fireEvent.press(errored.getByLabelText('Resume run'));
    expect(errored.workspace.runAction).toHaveBeenCalledWith('p1', 'r1', 'resume');
    fireEvent.press(errored.getByLabelText('Finish with current evidence'));
    expect(errored.workspace.runAction).toHaveBeenCalledWith('p1', 'r1', 'finish');
    expect(errored.getByText(/without new passes or a critic review/i)).toBeTruthy();
    await reset();
    const stopped = withRun('canceled', [stage('plan')]);
    expect(stopped.queryByLabelText('Finish with current evidence')).toBeNull();
    expect(stopped.getByTestId('research-report-unavailable').props.children).toMatch(/before gathering any evidence/i);
  });

  test('a budget-exhausted completed run can be finished again; the reason is shown', () => {
    const screen = withRun(
      'done',
      [stage('researcher'), stage('synthesis', 'done', { report: 'R' })],
      { budgetExhausted: true, reasons: ['max_tokens'] },
    );
    expect(screen.getByLabelText('Finish with current evidence')).toBeTruthy();
    expect(screen.getByTestId('research-budget-exhausted')).toBeTruthy();
    expect(screen.getByText(/re-freezes the report/i)).toBeTruthy();
  });

  test('View report needs the first done synthesis stage to hold a nonblank report; done alone is not enough', async () => {
    const blank = withRun('done', [stage('researcher'), stage('synthesis', 'done', { report: '   ' })]);
    expect(disabled(blank.getByLabelText('View report'))).toBe(true);
    fireEvent.press(blank.getByLabelText('View report'));
    expect(blank.workspace.loadReport).not.toHaveBeenCalled();
    await reset();
    const ready = withRun('done', [stage('synthesis', 'done', { report: '# Findings' })]);
    expect(disabled(ready.getByLabelText('View report'))).toBe(false);
    fireEvent.press(ready.getByLabelText('View report'));
    expect(ready.workspace.loadReport).toHaveBeenCalledWith('p1', 'r1');
  });

  test('pending actions are disabled for their own target', () => {
    const screen = withRun('error', [stage('researcher')], {}, { 'run:r1': 4 });
    expect(disabled(screen.getByLabelText('Resume run'))).toBe(true);
    expect(disabled(screen.getByLabelText('Finish with current evidence'))).toBe(true);
  });

  test('the report renders through the safe markdown display and can be closed; export errors are shown', async () => {
    const selected = run('r1', { progress: { stages: [stage('synthesis', 'done', { report: 'x' })] } });
    const screen = show({
      runs: [selected], selectedRunId: 'r1', runDetail: selected,
      report: { projectId: 'p1', runId: 'r1', markdown: '## Findings\n\nSome [link](https://example.test) text.' },
    });
    expect(screen.getByTestId('research-report')).toBeTruthy();
    expect(screen.getByText('Findings')).toBeTruthy();
    fireEvent.press(screen.getByText('Close report'));
    expect(screen.workspace.closeReport).toHaveBeenCalled();
    await reset();
    const failed = show({ runs: [selected], selectedRunId: 'r1', runDetail: selected, reportError: 'Report is not ready' });
    expect(failed.getByTestId('research-report-error').props.children).toBe('Report is not ready');
    expect(failed.queryByTestId('research-report')).toBeNull();
  });

  test('an archived project cannot start a run', () => {
    const screen = show({ projects: [project('p1', { archivedAt: TIME })] });
    expect(disabled(screen.getByLabelText('Start run'))).toBe(true);
    expect(disabled(screen.getByLabelText('Edit research settings'))).toBe(true);
  });
});

describe('ResearchProjectWorkspace settings and create drafts', () => {
  test('settings show canonical values, send only edited fields, and treat a blank field as invalid rather than zero', async () => {
    const existing = project('p1', { budget: { maxPasses: 0, maxTokens: 123_456, maxCostUsd: 2.5, maxWallClockMs: 90_000 } });
    const screen = show({ projects: [existing] });
    fireEvent.press(screen.getByLabelText('Edit research settings'));
    const dialog = within(screen.getByTestId('research-settings-dialog-surface'));
    // Untouched canonical values are shown precisely (zero passes, 1.5 minutes) and are not rounded.
    expect(dialog.getByLabelText('Researchers (passes)').props.value).toBe('0');
    expect(dialog.getByLabelText('Time limit (minutes)').props.value).toBe('1.5');
    fireEvent.changeText(dialog.getByLabelText('Token limit'), '200000');
    fireEvent.press(dialog.getByLabelText('Save research settings'));
    expect(screen.workspace.saveSettings).toHaveBeenCalledWith('p1', { budget: { maxTokens: 200_000 } });
    await reset();

    const blank = show({ projects: [existing] });
    fireEvent.press(blank.getByLabelText('Edit research settings'));
    const blankDialog = within(blank.getByTestId('research-settings-dialog-surface'));
    fireEvent.changeText(blankDialog.getByLabelText('Spending limit (USD)'), '');
    fireEvent.press(blankDialog.getByLabelText('Save research settings'));
    const [, edit] = (blank.workspace.saveSettings as jest.Mock).mock.calls[0];
    expect(Number.isNaN(edit.budget.maxCostUsd)).toBe(true);
  });

  test('unsaved edits survive a same-project refresh but never carry into another project', async () => {
    const first = makeWorkspace({ projects: [project('p1'), project('p2')] });
    const screen = render(tree(first));
    fireEvent.press(screen.getByLabelText('Edit research settings'));
    fireEvent.changeText(
      within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit'),
      '777777',
    );
    // Same-project refresh: a new project object with a newer updatedAt.
    screen.rerender(tree({ ...first, projects: [project('p1', { updatedAt: 'later' }), project('p2')] }));
    expect(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit').props.value).toBe('777777');
    // Selecting another project closes the dialog and discards the draft.
    screen.rerender(tree({ ...first, selectedProjectId: 'p2' }));
    await dialogClosed(screen, 'research-settings-dialog-surface');
    fireEvent.press(screen.getByLabelText('Edit research settings'));
    expect(within(screen.getByTestId('research-settings-dialog-surface')).getByLabelText('Token limit').props.value).toBe('5000000');
  });

  test('explicit model choices send both sides merged from canonical; an unavailable pinned model stays visible', () => {
    const pinned = { providerId: 'gone', modelId: 'old' };
    const spy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(((_options: any, callback: (index: number) => void) => {
      callback(1); // 0 = Research profile model, 1 = GPT (the lead side has no pinned model, so no extra row)
    }) as never);
    const screen = show({ projects: [project('p1', { modelPolicy: { lead: null, researcher: pinned } })] });
    expect(screen.getByText(/Researchers: gone\/old \(unavailable\)/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Edit research settings'));
    const dialog = within(screen.getByTestId('research-settings-dialog-surface'));
    expect(dialog.getByLabelText('Researcher model, gone/old (unavailable)')).toBeTruthy();
    fireEvent.press(dialog.getByLabelText('Lead model, Research profile model'));
    expect(spy).toHaveBeenCalled();
    fireEvent.press(dialog.getByLabelText('Save research settings'));
    // Only the edited side is sent; the provider merges the untouched side from its fresh canonical read.
    expect(screen.workspace.saveSettings).toHaveBeenCalledWith('p1', {
      modelPolicy: { lead: { providerId: 'openai', modelId: 'gpt' } },
    });
  });

  test('creating shows the canonical budget, sends parsed goals with an inherited model policy, then closes and clears the draft', async () => {
    const first = makeWorkspace({ projects: [] });
    const screen = render(tree(first));
    fireEvent.press(screen.getByLabelText('New research project'));
    const dialog = within(screen.getByTestId('research-create-dialog-surface'));
    // The canonical new-project budget is displayed before saving.
    expect(dialog.getByLabelText('Researchers (passes)').props.value).toBe('3');
    expect(dialog.getByLabelText('Token limit').props.value).toBe('5000000');
    expect(dialog.getByLabelText('Spending limit (USD)').props.value).toBe('5');
    expect(dialog.getByLabelText('Time limit (minutes)').props.value).toBe('30');
    fireEvent.changeText(dialog.getByLabelText('Project name'), 'Garden');
    fireEvent.changeText(dialog.getByLabelText('Research question'), 'Why?');
    fireEvent.changeText(dialog.getByLabelText('Goals, one per line'), 'one\ntwo');
    await act(async () => { fireEvent.press(dialog.getByLabelText('Save research project')); });
    expect(first.createProject).toHaveBeenCalledWith({
      name: 'Garden', question: 'Why?', goals: ['one', 'two'], domain: '',
      budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
      modelPolicy: null,
    });
    await dialogClosed(screen, 'research-create-dialog-surface');
    fireEvent.press(screen.getByLabelText('New research project'));
    expect(within(screen.getByTestId('research-create-dialog-surface')).getByLabelText('Project name').props.value).toBe('');
  });

  test('a failed create keeps its draft open; a different scope clears and closes it', async () => {
    const first = makeWorkspace({ projects: [] });
    (first.createProject as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const screen = render(tree(first));
    fireEvent.press(screen.getByLabelText('New research project'));
    const dialog = within(screen.getByTestId('research-create-dialog-surface'));
    fireEvent.changeText(dialog.getByLabelText('Project name'), 'Keep me');
    await act(async () => { fireEvent.press(dialog.getByLabelText('Save research project')); });
    expect(within(screen.getByTestId('research-create-dialog-surface')).getByLabelText('Project name').props.value).toBe('Keep me');

    screen.rerender(tree({ ...first, scope: 'scope-b' }));
    await dialogClosed(screen, 'research-create-dialog-surface');
    fireEvent.press(screen.getByLabelText('New research project'));
    expect(within(screen.getByTestId('research-create-dialog-surface')).getByLabelText('Project name').props.value).toBe('');
  });
});
