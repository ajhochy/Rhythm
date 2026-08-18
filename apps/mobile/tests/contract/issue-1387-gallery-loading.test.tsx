import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import RhythmToolScreen from '@/app/tools/[tool]';
import {
  AppRhythmToolsProvider,
  RhythmToolsProvider,
} from '@/providers/rhythm-tools-provider';
import {
  RhythmToolsService,
  type ToolRequestInit,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';

let mockRouteTool = 'gallery';
let mockActiveProjectPath: string | undefined;
let mockOpencodeHydrated = false;
let mockAccount: Record<string, unknown>;
let mockPairedHost: Record<string, unknown>;

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
  useLocalSearchParams: () => ({ tool: mockRouteTool }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProjectPath: mockActiveProjectPath,
    isHydrated: mockOpencodeHydrated,
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
  usePairedHost: () => mockPairedHost,
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => mockAccount,
}));

describe('paired tool loading deadline', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
    mockRouteTool = 'gallery';
    mockActiveProjectPath = undefined;
    mockOpencodeHydrated = false;
  });

  test('issue-1387-c20: a stalled Gallery relay request exits the shared loading state with retry', async () => {
    // Regression caught on a physical iPhone: a connected Cloud Gateway whose
    // paired catalog request never settles leaves Gallery (and other paired
    // tools) on the shared loading spinner forever. The loading-state and
    // retry assertions fail if the provider has no bounded request deadline.
    jest.useFakeTimers();
    const createStalledService = () => {
      const stalledPairedTransport: ToolTransport = {
        request: jest.fn(() => new Promise<never>(() => undefined)),
      };
      return new RhythmToolsService({
        cloud: stalledPairedTransport,
        paired: stalledPairedTransport,
        projectId: 'rhythm-owner-project',
      });
    };
    const screen = (service: RhythmToolsService) => (
      <PaperProvider>
        <RhythmToolsProvider
          cacheScope="issue-1387-c20"
          cloudAvailability="connected"
          pairedAvailability="connected"
          service={service}>
          <RhythmToolScreen />
        </RhythmToolsProvider>
      </PaperProvider>
    );

    const rendered = render(screen(createStalledService()));

    expect(rendered.getByText('Loading Gallery')).toBeTruthy();

    // The production wrapper replaces its service while account, paired-host,
    // and project state hydrate. Equivalent replacements must not restart the
    // visible screen's deadline or invalidate the watchdog generation.
    await act(async () => {
      jest.advanceTimersByTime(4_000);
    });
    rendered.rerender(screen(createStalledService()));
    await act(async () => {
      jest.advanceTimersByTime(4_000);
    });
    rendered.rerender(screen(createStalledService()));

    await act(async () => {
      jest.advanceTimersByTime(4_001);
      await Promise.resolve();
    });

    expect(rendered.queryByText('Loading Gallery')).toBeNull();
    expect(rendered.getByText('Could not load this screen')).toBeTruthy();
    expect(rendered.getByLabelText('Try again')).toBeTruthy();
  });

  test('the shared mounted deadline also exits Profiles loading', async () => {
    jest.useFakeTimers();
    mockRouteTool = 'profiles';
    const stalledPairedTransport: ToolTransport = {
      request: jest.fn(() => new Promise<never>(() => undefined)),
    };
    const service = new RhythmToolsService({
      cloud: stalledPairedTransport,
      paired: stalledPairedTransport,
      projectId: 'rhythm-owner-project',
    });

    const rendered = render(
      <PaperProvider>
        <RhythmToolsProvider
          cacheScope="issue-1387-c20-profiles"
          cloudAvailability="connected"
          pairedAvailability="connected"
          service={service}>
          <RhythmToolScreen />
        </RhythmToolsProvider>
      </PaperProvider>,
    );

    expect(rendered.getByText('Loading Profiles')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(12_001);
      await Promise.resolve();
    });

    expect(rendered.queryByText('Loading Profiles')).toBeNull();
    expect(rendered.getByText('Could not load this screen')).toBeTruthy();
    expect(rendered.getByLabelText('Try again')).toBeTruthy();
  });

  test.each(['gallery', 'profiles'])(
    'the real app provider keeps the original %s deadline through hydration scope changes',
    async (tool) => {
      jest.useFakeTimers();
      mockRouteTool = tool;
      const stalledPairedTransport: ToolTransport = {
        request: jest.fn(() => new Promise<never>(() => undefined)),
      };
      mockAccount = {
        client: stalledPairedTransport,
        state: 'signedOut',
        user: null,
      };
      mockPairedHost = {
        client: null,
        host: null,
        state: 'unpaired',
      };
      const screen = () => (
        <PaperProvider>
          <AppRhythmToolsProvider>
            <RhythmToolScreen />
          </AppRhythmToolsProvider>
        </PaperProvider>
      );

      const rendered = render(screen());

      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      mockAccount = {
        client: stalledPairedTransport,
        state: 'signedIn',
        user: { id: 18 },
      };
      mockPairedHost = {
        client: stalledPairedTransport,
        host: {
          deviceId: 'device-18',
          hostId: 'host-18',
          rhythmUserId: 18,
        },
        state: 'connected',
      };
      mockActiveProjectPath = 'rhythm-owner-project';
      mockOpencodeHydrated = true;
      rendered.rerender(screen());
      expect(rendered.getByText(`Loading ${tool === 'gallery' ? 'Gallery' : 'Profiles'}`)).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(12_001);
        await Promise.resolve();
      });

      expect(
        rendered.queryByText(`Loading ${tool === 'gallery' ? 'Gallery' : 'Profiles'}`),
      ).toBeNull();
      expect(rendered.getByText('Could not load this screen')).toBeTruthy();
      expect(rendered.getByLabelText('Try again')).toBeTruthy();
    },
  );

  test('issue-1387-c25: persisted Gallery scope stays restoring until cold hydration completes', async () => {
    // Regression caught on a physical iPhone: a persisted project and pairing
    // are briefly absent from provider state during a clean native launch, so
    // Gallery falsely shows the terminal "Select a project" screen for 8–13s
    // before the same persisted scope hydrates and its artifacts appear. The
    // pre-hydration assertions fail if that transient absence is treated as a
    // real missing-scope decision instead of an honest restoring state.
    const designs = [
      { id: 'hymn-of-love', title: 'Hymn of Love Reel' },
      { id: 'normal-worship-times', title: 'Normal Worship Times' },
    ];
    const mockPairedRequest = jest.fn(
      async (path: string, _init: ToolRequestInit): Promise<unknown> => {
        if (path === '/mobile-gateway/tools/agent-designs') return designs;
        throw new Error(`Unexpected paired request: ${path}`);
      },
    );
    const pairedTransport: ToolTransport = {
      async request<T>(path: string, init: ToolRequestInit): Promise<T> {
        return (await mockPairedRequest(path, init)) as T;
      },
    };
    mockAccount = {
      client: pairedTransport,
      state: 'signedIn',
      user: { id: 1387 },
    };
    mockPairedHost = {
      client: pairedTransport,
      host: {
        deviceId: 'iphone-cold-gallery',
        hostId: 'mac-cold-gallery',
        rhythmUserId: 1387,
      },
      state: 'connected',
    };
    const screen = () => (
      <PaperProvider>
        <AppRhythmToolsProvider>
          <RhythmToolScreen />
        </AppRhythmToolsProvider>
      </PaperProvider>
    );

    const rendered = render(screen());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rendered.queryByText('Select a project')).toBeNull();
    expect(
      rendered.getByText(/^(Loading|Restoring) Gallery$/),
    ).toBeTruthy();

    mockOpencodeHydrated = true;
    mockActiveProjectPath = 'rhythm-owner-project';
    rendered.rerender(screen());

    await waitFor(
      () => {
        expect(rendered.getByText('Hymn of Love Reel')).toBeTruthy();
        expect(rendered.getByText('Normal Worship Times')).toBeTruthy();
      },
      { timeout: 12_000 },
    );
    expect(mockPairedRequest).toHaveBeenCalledWith(
      '/mobile-gateway/tools/agent-designs',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Rhythm-Project-ID': 'rhythm-owner-project',
        }),
      }),
    );
  });

  test('Gallery still asks for a project after hydration confirms none is persisted', async () => {
    mockOpencodeHydrated = true;
    mockActiveProjectPath = undefined;
    mockAccount = {
      client: null,
      state: 'signedIn',
      user: { id: 1387 },
    };
    mockPairedHost = {
      client: null,
      host: null,
      state: 'unpaired',
    };

    const rendered = render(
      <PaperProvider>
        <AppRhythmToolsProvider>
          <RhythmToolScreen />
        </AppRhythmToolsProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(rendered.getByText('Select a project')).toBeTruthy();
    });
    expect(rendered.queryByText('Loading Gallery')).toBeNull();
  });
});
