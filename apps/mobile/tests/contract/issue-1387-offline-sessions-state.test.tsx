import { cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import AgentsScreen from '@/app/(tabs)/agents';
import {
  EXPECTED_CONTRACT_FINGERPRINT,
  PAIRED_HOST_META_KEY,
} from '@/lib/pairing/paired-host-store';
import { ActivityProvider } from '@/providers/activity-provider';
import { AgentChatProvider } from '@/providers/agent-chat-provider';
import { OpencodeProvider } from '@/providers/opencode-provider';
import { PairedHostProvider } from '@/providers/paired-host-provider';

const PROJECT_ID = '59243d52-8a77-4d81-94e8-df8d6acec734';
const PROJECT_NAME = 'Rhythm Relay Project';
const SESSION_ID = 'ses_offline_agents_catalog';

const mockSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  projectName: PROJECT_NAME,
  status: 'idle',
  title: 'Mirrored offline session',
  time: { created: 1, updated: 2 },
};

const mockStorage = new Map<string, string>();
const mockHost = {
  contractFingerprint: EXPECTED_CONTRACT_FINGERPRINT,
  deviceId: 'iphone-offline-agents',
  deviceName: 'Rhythm iPhone',
  features: [
    'pairing',
    'device-revocation',
    'project-scope',
    'opencode-http-proxy',
  ],
  gatewayUrl: 'https://rhythm-mac.invalid.ts.net',
  gatewayVersion: '1',
  hostId: 'mac-offline-agents',
  minimumMobileVersion: '1.0.8',
  opencodeVersion: '1.14.49',
  pairedAt: '2026-08-12T00:00:00.000Z',
  relayUrl: 'https://api.vcrcapps.com/relay',
  rhythmUserId: 1387,
  rhythmVersion: '1.0.8',
};

const mockRelayFetch = jest.fn(async (input: RequestInfo | URL) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith('/mobile-gateway/health')) {
    return new Response(JSON.stringify({
      ...mockHost,
      status: 'ready',
      macOnline: false,
      userId: 1387,
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }
  if (path.endsWith('/mobile-gateway/projects')) {
    return new Response(JSON.stringify({ error: 'mac_offline' }), {
      headers: { 'content-type': 'application/json' },
      status: 503,
    });
  }
  return new Response(JSON.stringify({ error: `unexpected:${path}` }), {
    headers: { 'content-type': 'application/json' },
    status: 404,
  });
});

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: jest.fn(() => ({
    app: { skills: jest.fn(async () => ({ data: [] })) },
    experimental: {
      session: { list: jest.fn(async () => ({ data: [], response: undefined })) },
    },
    path: { get: jest.fn(async () => ({ data: { directory: '' } })) },
    permission: { list: jest.fn(async () => ({ data: [] })) },
    project: {
      current: jest.fn(async () => ({ data: undefined })),
      list: jest.fn(async () => ({ data: [] })),
    },
    question: { list: jest.fn(async () => ({ data: [] })) },
    session: {
      list: jest.fn(async () => ({ data: [] })),
      status: jest.fn(async () => ({ data: {} })),
    },
  })),
}), { virtual: true });

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
  },
}));

jest.mock('@rhythm/mobile-runtime', () => ({
  mobileRuntimeVariant: {
    cacheScope: null,
    createActivityTransport: () => null,
    createPairedHostStore: () => null,
    serverUrl: 'http://127.0.0.1:4096',
  },
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => 'device-token'),
  setItemAsync: jest.fn(async () => undefined),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ state: 'signedIn', user: { id: 1387 } }),
}));

jest.mock('@/lib/security/connection-account-scope', () => ({
  runPairedHostStateTransition: jest.fn(
    async (operation: () => Promise<unknown>) => operation(),
  ),
}));

jest.mock('@/lib/security/connection-credential-store', () => ({
  purgeDirectMacStateForUser: jest.fn(async () => undefined),
}));

jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: () => ({ isHydrated: true }),
}));

jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));

jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined),
  trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));

jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn(async () => false),
  stopSpeaking: jest.fn(async () => undefined),
}));

jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => undefined),
  stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));

jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({
    abort: jest.fn(),
    error: undefined,
    errorCode: undefined,
    isAvailable: false,
    isListening: false,
    isStarting: false,
    level: 0,
    start: jest.fn(),
    stop: jest.fn(),
    supportsLocalRecognition: false,
  }),
}));

jest.mock('@/providers/use-conversation-keep-awake', () => ({
  useConversationKeepAwake: jest.fn(),
}));

jest.mock('@/providers/use-conversation-screen-dim', () => ({
  useConversationScreenDim: jest.fn(),
}));

function renderOfflineCatalog() {
  return render(
    <PaperProvider>
      <PairedHostProvider>
        <OpencodeProvider>
          <AgentChatProvider>
            <ActivityProvider
              availability="offline"
              cacheScope="issue-1387-offline-agents"
              transport={null}>
              <AgentsScreen />
            </ActivityProvider>
          </AgentChatProvider>
        </OpencodeProvider>
      </PairedHostProvider>
    </PaperProvider>,
  );
}

describe('issue-1387 offline Agents catalog state', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockStorage.set(PAIRED_HOST_META_KEY, JSON.stringify(mockHost));
    mockStorage.set(
      'rhythm.agent-chat.read-cache.v1.1387_mac-offline-agents_iphone-offline-agents',
      JSON.stringify([mockSession]),
    );
    global.fetch = mockRelayFetch as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1387-c26: an offline mirrored Agents catalog never claims Connected', async () => {
    // Regression caught on a physical iPhone: relay health truthfully reports
    // macOnline:false and cached mirrored sessions render, but the list banner
    // reuses the paired-host transport message and falsely says Connected.
    // The offline message assertion fails if the UI ignores the real
    // OpencodeProvider desktop-offline state.
    const screen = renderOfflineCatalog();

    await waitFor(() => {
      expect(screen.getByText(mockSession.title)).toBeTruthy();
      expect(screen.getByTestId('paired-mac-offline-state')).toBeTruthy();
    });

    expect(
      screen.getByText('Desktop offline — you can still read sessions.'),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        'Connected securely to your Mac through Rhythm Cloud Gateway.',
      ),
    ).toBeNull();
  });

  test('issue-1387-c27: an offline mirrored session preserves its project name', async () => {
    // Regression caught on a physical iPhone: the offline session cache keeps
    // the mirror's safe project name, but ChatList resolves labels only from
    // the unavailable live project catalog and renders "Unknown project".
    // The metadata assertion fails if the session's mirrored label is dropped.
    const screen = renderOfflineCatalog();

    await waitFor(() => {
      expect(screen.getByText(mockSession.title)).toBeTruthy();
    });

    expect(screen.getByText(`${PROJECT_NAME} · idle`)).toBeTruthy();
    expect(screen.queryByText('Unknown project · idle')).toBeNull();
  });
});
