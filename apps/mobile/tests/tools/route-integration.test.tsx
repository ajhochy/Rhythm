import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import ToolsScreen from '@/app/(tabs)/tools';
import RhythmToolScreen from '@/app/tools/[tool]';
import { TOOL_SCREEN_MANIFEST, type ToolRecord, type ToolScreenId } from '@/providers/services/rhythm-tools-service';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRefresh = jest.fn().mockResolvedValue(undefined);
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
}));
jest.mock('@/providers/rhythm-tools-provider', () => ({
  useRhythmTools: () => ({
    getGalleryArtifactSource: jest.fn(),
    getState: () => ({
      error: null,
      errorState: null,
      items: mockItems,
      loading: false,
      offline: false,
    }),
    perform: jest.fn(),
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
    startMcpOAuth: jest.fn(),
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

  const search = screen.getByRole('search', { name: 'Search Brain' });
  fireEvent.changeText(search, 'volunteer');
  expect(screen.getByText('Sunday handoff')).toBeTruthy();
  expect(screen.queryAllByRole('button', { name: 'Search Brain' })).toHaveLength(0);
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
