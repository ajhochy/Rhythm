import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import ToolsScreen from '@/app/(tabs)/tools';
import RhythmToolScreen from '@/app/tools/[tool]';
import { TOOL_SCREEN_MANIFEST, type ToolRecord, type ToolScreenId } from '@/providers/services/rhythm-tools-service';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockPerform = jest.fn().mockResolvedValue({});
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockGetGalleryArtifactSource = jest.fn().mockResolvedValue(null);
const mockStartMcpOAuth = jest.fn();
let mockTool: ToolScreenId = 'brain';
let mockItems: ToolRecord[] = [];

jest.mock('expo-av', () => ({ ResizeMode: { CONTAIN: 'contain' }, Video: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ tool: mockTool }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
}));
jest.mock('@/providers/rhythm-tools-provider', () => ({
  useRhythmTools: () => ({
    getGalleryArtifactSource: mockGetGalleryArtifactSource,
    getState: () => ({
      error: null,
      errorState: null,
      items: mockItems,
      loading: false,
      offline: false,
    }),
    perform: mockPerform,
    refresh: mockRefresh,
  }),
}));
jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    chatPreferences: {},
    completeMcpOAuth: jest.fn(),
    completeProviderOAuth: jest.fn(),
    loadOpenCodeInspection: jest.fn(),
    reloadOpenCodeConfig: jest.fn(),
    reloadOpenCodeSkills: jest.fn(),
    removeMcpOAuth: jest.fn(),
    removeProvider: jest.fn(),
    startMcpOAuth: mockStartMcpOAuth,
    startProviderOAuth: jest.fn(),
  }),
}));

const descriptions: Record<ToolScreenId, string> = {
  brain: 'Search and maintain agent memory',
  research: 'Start, follow, and review deep research',
  schedules: 'Create jobs and run them on demand',
  webhooks: 'Secure inbound automation endpoints',
  profiles: 'Agent prompts, models, scope, and delegation',
  cookbook: 'Reusable, profile-bound agent recipes',
  review: 'Approve or reject optimizer proposals',
  'report-card': 'Completion, escalation, and quality trends',
  email: 'Cloud email signals, even while Mac is offline',
  gallery: 'Cloud design previews and generated assets',
  skills: 'View and author approved agent skills',
  playbooks: 'Manage reusable slash-command workflows',
  mcp: 'Connect and inspect MCP servers',
  models: 'Providers, authentication, and model availability',
};

function renderDetail(tool: ToolScreenId, items: ToolRecord[]) {
  mockTool = tool;
  mockItems = items;
  return render(
    <PaperProvider>
      <RhythmToolScreen />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPerform.mockResolvedValue({});
  mockGetGalleryArtifactSource.mockResolvedValue(null);
  mockStartMcpOAuth.mockResolvedValue('https://auth.example.test/mcp');
  mockTool = 'brain';
  mockItems = [];
});

test('slice-a-c1: Tools route renders the exact manifest as grouped catalog rows and preserves destinations', () => {
  // Regression caught: route wiring duplicates or drops a manifest entry, changes its label, or pushes the wrong destination.
  const screen = render(
    <PaperProvider>
      <ToolsScreen />
    </PaperProvider>,
  );

  expect(screen.getByLabelText('Agent tools')).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(14);
  for (const entry of TOOL_SCREEN_MANIFEST) {
    const row = screen.getByRole('button', {
      name: `${entry.title}. ${descriptions[entry.id]}`,
    });
    fireEvent.press(row);
    expect(mockPush).toHaveBeenLastCalledWith(entry.route);
  }
});

test('slice-a-c3: Brain route uses the search-first primitive without adding a second search action', () => {
  // Regression caught: integration changes live query filtering into a submit-only flow or adds a duplicate Search button.
  const screen = renderDetail('brain', [
    { id: 'memory-1', title: 'Sunday handoff', content: 'Call the volunteer coordinator.' },
  ]);

  const routeScroll = screen.getByTestId('tool-route-scroll');
  expect(routeScroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(routeScroll.props.keyboardDismissMode).toBeDefined();
  const search = screen.getByRole('search', { name: 'Search Brain' });
  fireEvent.changeText(search, 'volunteer');
  expect(screen.getByText('Sunday handoff')).toBeTruthy();
  expect(screen.queryAllByRole('button', { name: 'Search Brain' })).toHaveLength(0);
  fireEvent.press(screen.getByText('Sunday handoff'));
  expect(screen.getByRole('header', { name: 'Memory details' })).toBeTruthy();
});

test('slice-a-c4: Review Queue pairs proposal status and next decision without replacing its actions', () => {
  // Regression caught: the redesign separates decision context from the proposal or drops approve/reject controls.
  const screen = renderDetail('review', [
    {
      id: 'proposal-1',
      title: 'High-risk model change',
      status: 'proposed',
      risk: 'high',
      rationale: 'Move the executive agent to a frontier model.',
    },
  ]);

  fireEvent.press(screen.getByLabelText('High-risk model change. proposed'));
  const summary = screen.getByLabelText(
    'Status proposed. Move the executive agent to a frontier model. Next decision: Approve or reject this proposal.',
  );
  expect(summary.props.accessibilityRole).toBe('summary');
  expect(screen.getByRole('button', { name: 'Approve proposal' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeTruthy();
});

test('slice-a-c5: MCP records separate known connection dimensions without fabricating authentication', () => {
  // Regression caught: one connected label is presented as proof of authentication, enablement, and configuration.
  const screen = renderDetail('mcp', [
    {
      id: 'planning-center',
      name: 'planning-center',
      status: 'connected',
      enabled: true,
      type: 'remote',
      url: 'https://mcp.example.test/a-very-long-configuration-identifier',
    },
  ]);

  expect(screen.getByText('Reachability')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('Authentication')).toBeTruthy();
  expect(screen.getByText('Not reported')).toBeTruthy();
  expect(screen.getByText('Enablement')).toBeTruthy();
  expect(screen.getByText('Enabled')).toBeTruthy();
  expect(screen.getByText('Configuration')).toBeTruthy();
  expect(screen.getByText('remote · https://mcp.example.test/a-very-long-configuration-identifier')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Authenticate planning-center' })).toBeTruthy();
});

test('slice-a-c6: Providers & Models summarizes grouped production data and keeps provider actions', () => {
  // Regression caught: grouped presentation drops stable model IDs or replaces provider authentication actions.
  const screen = renderDetail('models', [
    {
      id: 'openai',
      name: 'OpenAI',
      providerID: 'openai',
      connected: true,
      authMethodCount: 1,
      models: [{ id: 'gpt-a-very-long-model-id-that-must-wrap', name: 'GPT Long' }],
    },
  ]);

  expect(screen.getByRole('header', { name: 'OpenAI' })).toBeTruthy();
  expect(screen.getByText('GPT Long')).toBeTruthy();
  expect(screen.getByText('gpt-a-very-long-model-id-that-must-wrap')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Authenticate OpenAI' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove OpenAI credentials' })).toBeTruthy();
});

test('long profile forms scroll inside a bounded dialog and preserve their reachable save action', () => {
  const screen = renderDetail('profiles', [
    { id: 'profile-1', label: 'Sunday coordinator' },
  ]);

  const profileCard = screen.getAllByLabelText(/Sunday coordinator/).find(
    (element) => element.props.accessibilityLabel === 'Sunday coordinator. ',
  );
  expect(profileCard).toBeTruthy();
  fireEvent.press(profileCard!);
  const profileScroll = screen.getByTestId('tool-profile-dialog-scroll');
  expect(profileScroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(profileScroll.props.keyboardDismissMode).toBeDefined();
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeTruthy();
});

test('short OAuth headings retain the server context in the scrollable body and preserve completion controls', async () => {
  const serverName = 'planning-center-with-a-very-long-name';
  const screen = renderDetail('mcp', [{
    id: serverName,
    name: serverName,
    status: 'disconnected',
  }]);

  fireEvent.press(screen.getByRole('button', { name: `Authenticate ${serverName}` }));

  await waitFor(() => {
    expect(screen.getByRole('header', { name: 'Complete MCP authorization' })).toBeTruthy();
  });
  expect(screen.getByLabelText(`Authorizing ${serverName}`).props.numberOfLines).toBe(2);
  expect(screen.getByLabelText('MCP authorization code')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Complete MCP authorization' })).toBeTruthy();
});

test('schedule editor keeps its cron alias visible and preserves the bounded save action', async () => {
  const cron = '0 9 * * 1';
  const screen = renderDetail('schedules', [{
    cron,
    enabled: true,
    id: 'weekly-review',
    name: 'Weekly review',
  }]);

  fireEvent.press(screen.getByText('Weekly review'));
  expect(screen.getByText(`Schedule: ${cron}`)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Weekly review' }));

  expect(screen.getByRole('header', { name: 'Edit scheduled job' })).toBeTruthy();
  expect(screen.getByLabelText('Cron schedule').props.value).toBe(cron);
  expect(screen.getByRole('button', { name: 'Save scheduled job changes' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Save scheduled job changes' }));

  await waitFor(() => {
    expect(mockPerform).toHaveBeenCalledWith(
      'schedules',
      'schedules:update',
      expect.objectContaining({ cron, cronExpression: cron, id: 'weekly-review' }),
    );
  });
});

test('profile creation preserves its explicit empty-scope action input', async () => {
  const screen = renderDetail('profiles', []);
  fireEvent.press(screen.getByRole('button', { name: 'New profile' }));
  fireEvent.changeText(screen.getByLabelText('Profile name'), 'Prayer lead');
  fireEvent.changeText(screen.getByLabelText('Profile prompt'), 'Lead the prayer handoff.');
  fireEvent.press(screen.getByRole('button', { name: 'Create profile' }));

  await waitFor(() => {
    expect(mockPerform).toHaveBeenCalledWith(
      'profiles',
      'profiles:create',
      expect.objectContaining({
        allowedDelegatesJson: '[]',
        allowedMcpsJson: '[]',
        label: 'Prayer lead',
        systemPrompt: 'Lead the prayer handoff.',
      }),
    );
  });
});

test('catalog search only exposes Clear after a meaningful query and selected controls retain a visible state', () => {
  const screen = renderDetail('profiles', []);

  expect(screen.queryByRole('button', { name: 'Clear Profiles search' })).toBeNull();
  fireEvent.changeText(screen.getByRole('search', { name: 'Search Profiles' }), 'prayer');
  expect(screen.getByRole('button', { name: 'Clear Profiles search' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Clear Profiles search' }));
  expect(screen.getByRole('search', { name: 'Search Profiles' }).props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Category' }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole('button', { name: 'A–Z' }).props.accessibilityState.checked).toBe(true);
});

test('gallery unavailable details retain supplied metadata and a safe project affordance instead of a warning-only screen', async () => {
  const screen = renderDetail('gallery', [{
    artifactType: 'png',
    id: 'gallery-1',
    projectUrl: 'https://design.example.test/project/weekly-announcement',
    provider: 'Canva',
    status: 'completed',
    title: 'Weekly announcement',
    updatedAt: '2026-10-03T12:00:00.000Z',
  }]);

  expect(screen.getByRole('button', { name: 'View details for Weekly announcement' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'View details for Weekly announcement' }));

  await waitFor(() => {
    expect(screen.getByText('Preview unavailable on this device.')).toBeTruthy();
  });
  const galleryDialog = within(screen.getByTestId('gallery-preview-dialog-surface'));
  expect(galleryDialog.getByRole('header', { name: 'Item details' })).toBeTruthy();
  expect(galleryDialog.getByText('Status: completed')).toBeTruthy();
  expect(galleryDialog.getByText('Artifact type: png')).toBeTruthy();
  expect(galleryDialog.getByText('Provider: Canva')).toBeTruthy();
  expect(galleryDialog.getByText('Open project link')).toBeTruthy();
  expect(mockGetGalleryArtifactSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'gallery-1' }));
});

test('long email previews are decoded, bounded, and retain their full source data outside the preview renderer', () => {
  const previewText = "We haven't received & processed this yet.";
  const screen = renderDetail('email', [{
    fromEmail: 'alerts@example.test',
    id: 'email-1',
    snippet: 'We haven&#39;t received &amp; processed this yet.',
    subject: 'Status update',
  }]);

  const preview = screen.getByText(previewText);
  expect(preview.props.numberOfLines).toBe(3);
  expect(preview.props.ellipsizeMode).toBe('tail');
  fireEvent.press(screen.getByText('Status update'));
  expect(screen.getByRole('header', { name: 'Email signal details' })).toBeTruthy();
  expect(screen.getByText('From: alerts@example.test')).toBeTruthy();
  const previewInstances = screen.getAllByText(previewText);
  expect(previewInstances.some((instance) => instance.props.numberOfLines === 3)).toBe(true);
  expect(previewInstances.some((instance) => instance.props.numberOfLines === undefined)).toBe(true);
  expect(screen.getByRole('button', { name: 'Close details' })).toBeTruthy();
});

test('report cards show each rate once and distinguish missing data from a measured zero', () => {
  const screen = renderDetail('report-card', [{
    agentLabel: 'Coding agent',
    completionRate: 0,
    escalationRate: null,
    id: 'report-1',
  }]);

  expect(screen.getAllByText('Success rate 0%')).toHaveLength(1);
  expect(screen.getByText('Escalation rate — not enough data')).toBeTruthy();
});

test('research reports use the safe markdown display and retain an immediate Close action', () => {
  const query = 'A long research query that should remain context rather than become the report heading';
  const screen = renderDetail('research', [{
    id: 'research-1',
    query,
    report: [
      '## Findings',
      '| Finding | Assessment |',
      '|---|---|',
      '| [MCP SDK](https://example.test/releases) | Review credentials. |',
    ].join('\n'),
    status: 'completed',
  }]);

  fireEvent.press(screen.getByText(query));
  expect(screen.getByRole('header', { name: 'Research report' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Close report' })).toBeTruthy();
  expect(screen.getByText('Findings')).toBeTruthy();
  expect(screen.getByText(/MCP SDK \(https:\/\/example\.test\/releases\)/)).toBeTruthy();
  expect(screen.queryByText('| Finding | Assessment |')).toBeNull();
});

test('research Retry is offered only for a server-owned strict canRetry===true error row', () => {
  // Missing, false and non-boolean eligibility (and non-error rows) never enable Retry; the exact row id is retried.
  const screen = renderDetail('research', [
    { id: 'job-true', query: 'eligible job', status: 'error', canRetry: true },
    { id: 'job-false', query: 'ineligible false job', status: 'error', canRetry: false },
    { id: 'job-missing', query: 'older backend job', status: 'error' },
    { id: 'job-string', query: 'non boolean job', status: 'error', canRetry: 'true' },
    { id: 'job-done', query: 'completed job', status: 'completed', canRetry: true },
  ]);

  expect(screen.getAllByText('Retry')).toHaveLength(1);
  fireEvent.press(screen.getByText('Retry'));
  expect(mockPerform).toHaveBeenCalledWith('research', 'research:retry', { id: 'job-true' });
});

test('Brain editor uses a stable heading while leaving the selected title in its scrollable context', () => {
  const title = 'A very long memory title that would otherwise consume the dialog heading at large Dynamic Type';
  const screen = renderDetail('brain', [{
    content: 'Remember the coordinator handoff.',
    id: 'memory-1',
    title,
  }]);

  fireEvent.press(screen.getByText(title));
  fireEvent.press(screen.getByRole('button', { name: 'Edit memory' }));
  expect(screen.getByRole('header', { name: 'Edit memory' })).toBeTruthy();
  expect(screen.getByLabelText(`Editing ${title}`)).toBeTruthy();
  expect(screen.getByTestId('tool-edit-dialog-scroll').props.keyboardShouldPersistTaps).toBe('handled');
  expect(screen.getByRole('button', { name: 'Save memory changes' })).toBeTruthy();
});

test('webhook details show a long URL once while retaining Copy, Rotate, and Delete actions', () => {
  const url = 'https://api.example.test/agent-webhooks/a-very-long-webhook-identifier/receive';
  const screen = renderDetail('webhooks', [{
    id: 'webhook-1',
    name: 'Issue trigger',
    url,
  }]);

  fireEvent.press(screen.getByText('Issue trigger'));
  expect(screen.getAllByText(url)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Copy Issue trigger URL' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rotate Issue trigger secret' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete Issue trigger' })).toBeTruthy();
});
