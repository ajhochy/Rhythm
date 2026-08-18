import { act, cleanup, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import RhythmToolScreen from '@/app/tools/[tool]';
import { RhythmToolsProvider } from '@/providers/rhythm-tools-provider';
import {
  RhythmToolsService,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';

jest.mock('expo-av', () => ({
  ResizeMode: { CONTAIN: 'contain' },
  Video: () => null,
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ tool: 'models' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProjectPath: 'rhythm-owner-project',
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

jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({ client: null, host: null, state: 'unpaired' }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ client: null, state: 'signedOut', user: null }),
}));

describe('Providers & Models paired catalog loading', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('issue-1387-c21: Providers & Models renders successful paired catalog data without waiting for stalled provider auth', async () => {
    // Regression caught on a physical iPhone: the real Models service combines
    // provider, provider-auth, and config relay calls with Promise.all. If the
    // engine's /provider/auth boundary never settles, successful provider/model
    // and config responses are discarded and the real screen reaches the
    // shared generic timeout. The OpenAI/GPT assertions below fail for that bug.
    jest.useFakeTimers();
    const paired: ToolTransport = {
      request: jest.fn((path) => {
        if (path === '/mobile-gateway/opencode/provider') {
          return Promise.resolve({
            all: [
              {
                id: 'openai',
                name: 'OpenAI',
                providerID: 'openai',
                models: {
                  'gpt-4.1-mini': {
                    id: 'gpt-4.1-mini',
                    name: 'GPT-4.1 mini',
                  },
                },
              },
            ],
            connected: ['openai'],
          });
        }
        if (path === '/mobile-gateway/opencode/config') {
          return Promise.resolve({ enabled_providers: ['openai'] });
        }
        if (path === '/mobile-gateway/opencode/provider/auth') {
          return new Promise<never>(() => undefined);
        }
        return Promise.reject(new Error(`Unexpected paired path: ${path}`));
      }) as ToolTransport['request'],
    };
    const service = new RhythmToolsService({
      cloud: paired,
      paired,
      projectId: 'rhythm-owner-project',
    });

    const rendered = render(
      <PaperProvider>
        <RhythmToolsProvider
          cacheScope="issue-1387-c21"
          cloudAvailability="connected"
          pairedAvailability="connected"
          service={service}>
          <RhythmToolScreen />
        </RhythmToolsProvider>
      </PaperProvider>,
    );

    expect(rendered.getByText('Loading Providers & Models')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(11_999);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.queryByText('Loading Providers & Models')).toBeNull();
    expect(rendered.queryByText('Could not load this screen')).toBeNull();
    expect(rendered.getByText('OpenAI')).toBeTruthy();
    expect(rendered.getByText('GPT-4.1 mini')).toBeTruthy();
  });
});
