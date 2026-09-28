import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, ScrollView } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import AgentTerminalScreen from '@/app/agents/terminal';

const mockCloseTerminal = jest.fn().mockResolvedValue(undefined);
const mockGetTerminalDetail = jest.fn().mockResolvedValue({
  id: 'pty-2',
  command: 'zsh',
  cwd: '/workspace/other',
  pid: 202,
  status: 'running',
});
const mockOpenTerminal = jest.fn().mockResolvedValue(undefined);
const mockRefreshTerminals = jest.fn().mockResolvedValue(undefined);
let mockTerminalOutput = 'first output';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProject: { id: 'rhythm', label: 'Rhythm', path: '/workspace/rhythm' },
    activeTerminalId: 'pty-1',
    closeTerminal: mockCloseTerminal,
    connect: jest.fn(),
    connection: { status: 'connected' },
    createTerminal: jest.fn(),
    getTerminalDetail: mockGetTerminalDetail,
    openTerminal: mockOpenTerminal,
    refreshTerminals: mockRefreshTerminals,
    resizeTerminal: jest.fn(),
    sendTerminalInput: jest.fn(),
    terminalConnection: 'connected',
    terminalOutput: mockTerminalOutput,
    terminals: [
      { id: 'pty-1', command: 'bash', cwd: '/workspace/rhythm', pid: 101, status: 'running', title: 'Primary' },
      { id: 'pty-2', command: 'zsh', cwd: '/workspace/other', pid: 202, status: 'running', title: 'Other terminal' },
    ],
  }),
}));

function renderRoute() {
  return render(
    <PaperProvider>
      <AgentTerminalScreen />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTerminalOutput = 'first output';
});

test('terminal route wires selection, refresh, and confirmed close to the provider', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const screen = renderRoute();

  fireEvent.press(screen.getByTestId('terminal-selector'));
  fireEvent.press(await screen.findByText('Other terminal'));
  await waitFor(() => {
    expect(mockOpenTerminal).toHaveBeenCalledWith('pty-2');
    expect(mockGetTerminalDetail).toHaveBeenCalledWith('pty-2');
  });

  mockRefreshTerminals.mockClear();
  fireEvent.press(screen.getByLabelText('Refresh terminals'));
  await waitFor(() => expect(mockRefreshTerminals).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByTestId('terminal-close-button'));
  expect(alert).toHaveBeenCalledWith(
    'Terminate terminal?',
    'Primary',
    expect.any(Array),
  );
  const terminate = alert.mock.calls[0]?.[2]?.find((button) => button.text === 'Terminate');
  await act(async () => terminate?.onPress?.());
  expect(mockCloseTerminal).toHaveBeenCalledWith('pty-1');
});

test('terminal route follows changed output without animation', () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const screen = renderRoute();
  scrollToEnd.mockClear();

  mockTerminalOutput = 'first output\nsecond output';
  screen.rerender(
    <PaperProvider>
      <AgentTerminalScreen />
    </PaperProvider>,
  );

  expect(screen.getByTestId('terminal-output')).toHaveTextContent(/second output/);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
});
