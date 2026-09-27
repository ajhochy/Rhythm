import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Linking,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatView } from '@/components/chat/chat-view';
import { MOBILE_ATTACHMENT_LIMIT_BYTES } from '@/lib/attachments/limits';

const mockGetDocumentAsync = jest.fn();
const mockGetCameraPermission = jest.fn();
const mockRequestCameraPermission = jest.fn();
const mockTakePictureAsync = jest.fn();
const mockSendPrompt = jest.fn();
let mockCameraPermission: {
  canAskAgain: boolean;
  granted: boolean;
  status: 'denied' | 'granted' | 'undetermined';
} | null;
let mockCapturedFileSize: number | null;

jest.mock('expo-document-picker', () => {
  const getDocumentAsync = (...args: unknown[]) => mockGetDocumentAsync(...args);
  return {
    __esModule: true,
    default: { getDocumentAsync },
    getDocumentAsync,
  };
});
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const ReactNative = jest.requireActual('react-native');
  return {
    CameraView: React.forwardRef(function MockCameraView(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePictureAsync }));
      React.useEffect(() => {
        (props.onCameraReady as (() => void) | undefined)?.();
      }, [props.onCameraReady]);
      return <ReactNative.View testID="mock-camera-view" />;
    }),
    useCameraPermissions: () => {
      const [refreshedPermission, setRefreshedPermission] = React.useState(null);
      return [
        refreshedPermission ?? mockCameraPermission,
        mockRequestCameraPermission,
        async () => {
          const next = await mockGetCameraPermission();
          setRefreshedPermission(next);
          return next;
        },
      ];
    },
  };
});
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    size = mockCapturedFileSize;
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => false,
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 12, left: 0, right: 0, top: 20 }),
}));
jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn(),
  stopSpeaking: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({
    error: undefined,
    isAvailable: false,
    isListening: false,
    start: jest.fn(),
    stop: jest.fn(),
  }),
}));
jest.mock('@/components/chat/chat-header', () => ({ ChatHeader: () => null }));
jest.mock('@/components/chat/chat-content', () => ({ ChatContent: () => null }));
jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));
jest.mock('@/components/chat/chat-composer', () => {
  const ReactNative = jest.requireActual('react-native');
  return { ChatComposer: ({ attachments, onAttach, onSend }: {
    attachments: { filename?: string; mime?: string; uri: string }[];
    onAttach: () => void;
    onSend: () => void;
  }) => (
    <ReactNative.View>
      <ReactNative.Pressable
        accessibilityLabel="Add attachment"
        testID="chat-attachment-button"
        onPress={onAttach}>
        <ReactNative.Text>Add attachment</ReactNative.Text>
      </ReactNative.Pressable>
      {attachments.map((attachment) => (
        <ReactNative.Text key={attachment.uri} testID="draft-attachment">
          {`${attachment.filename}|${attachment.mime}|${attachment.uri}`}
        </ReactNative.Text>
      ))}
      <ReactNative.Pressable accessibilityLabel="Send message" onPress={onSend}>
        <ReactNative.Text>Send</ReactNative.Text>
      </ReactNative.Pressable>
    </ReactNative.View>
  ),
}; });

const mockOpencodeState = {
  abortSession: jest.fn(),
  activeProjectPath: '/project',
  activeSession: { id: 'session-1', title: 'Chat' },
  availableAgents: [],
  availableModels: [],
  chatPreferences: {
    autoPlayAssistantReplies: false,
    modelId: 'model',
    preferOnDeviceRecognition: false,
    speechLocale: 'en-US',
    speechRate: 1,
  },
  clearConversationFeedback: jest.fn(),
  clearPromptError: jest.fn(),
  commands: [],
  configuredProviders: [],
  connection: { message: '', status: 'connected' },
  conversation: { active: false, feedback: undefined },
  createSession: jest.fn(),
  currentDiffs: [],
  currentMessages: [],
  currentPendingPermissions: [],
  currentPendingQuestions: [],
  currentSessionId: 'session-1',
  currentTodos: [],
  currentTranscript: [],
  currentUsage: undefined,
  deleteSessionMessage: jest.fn(),
  deleteSessionPart: jest.fn(),
  ensureActiveSession: jest.fn(),
  executeCommand: jest.fn(),
  forkSession: jest.fn(),
  getSessionChildren: jest.fn(),
  hasOlderMessages: false,
  initializeSession: jest.fn(),
  isRefreshingDiffs: false,
  isRefreshingMessages: false,
  loadOlderMessages: jest.fn(),
  promptError: undefined,
  refreshCurrentSession: jest.fn(),
  rejectQuestion: jest.fn(),
  replyToPermission: jest.fn(),
  replyToQuestion: jest.fn(),
  revertSession: jest.fn(),
  runSessionShell: jest.fn(),
  sendPrompt: mockSendPrompt,
  sendingState: { active: false },
  sessionStatuses: {},
  sessions: [],
  settings: { serverUrl: 'http://localhost' },
  toggleConversationMode: jest.fn(),
  unrevertSession: jest.fn(),
  updateSessionPreferences: jest.fn(),
  updateSessionTextPart: jest.fn(),
};

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => mockOpencodeState,
}));

function renderChat() {
  return render(
    <PaperProvider>
      <ChatView />
    </PaperProvider>,
  );
}

async function pressNativeAttachmentChoice(
  screen: ReturnType<typeof renderChat>,
  label: 'Choose File' | 'Take Photo',
) {
  fireEvent.press(screen.getByTestId('chat-attachment-button'));
  const [, , actions] = jest.mocked(Alert.alert).mock.calls.at(-1)!;
  await act(async () => actions?.find((action) => action.text === label)?.onPress?.());
}

describe('native camera chat attachments', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockCameraPermission = { canAskAgain: true, granted: true, status: 'granted' };
    mockCapturedFileSize = 1024;
    mockGetDocumentAsync.mockResolvedValue({ canceled: true });
    mockGetCameraPermission.mockResolvedValue(mockCameraPermission);
    mockRequestCameraPermission.mockResolvedValue({
      canAskAgain: true,
      granted: true,
      status: 'granted',
    });
    mockTakePictureAsync.mockResolvedValue({ uri: 'file:///camera/capture.jpg' });
    mockSendPrompt.mockResolvedValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  test('mobile-camera-c1: native activation offers exactly camera, file, and cancel choices', () => {
    // Regression caught: native activation opens the document picker directly,
    // so the exact three-action assertion fails and camera is unreachable.
    const screen = renderChat();

    fireEvent.press(screen.getByTestId('chat-attachment-button'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, , actions] = jest.mocked(Alert.alert).mock.calls[0];
    expect(actions?.map((action) => action.text)).toEqual([
      'Take Photo',
      'Choose File',
      'Cancel',
    ]);
    expect(mockGetDocumentAsync).not.toHaveBeenCalled();
  });

  test('mobile-camera-c2: choose file preserves the existing multiple-file picker and duplicate behavior', async () => {
    // Regression caught: inserting the native choice changes picker options or
    // bypasses URI de-duplication; these exact option and row assertions fail.
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { mimeType: 'text/plain', name: 'one.txt', size: 4, uri: 'file:///one.txt' },
        { mimeType: 'text/plain', name: 'one-copy.txt', size: 4, uri: 'file:///one.txt' },
        { mimeType: 'image/png', name: 'two.png', size: 8, uri: 'file:///two.png' },
      ],
    });
    const screen = renderChat();

    await pressNativeAttachmentChoice(screen, 'Choose File');

    expect(mockGetDocumentAsync).toHaveBeenCalledWith({
      base64: false,
      copyToCacheDirectory: true,
      multiple: true,
    });
    expect(screen.getAllByTestId('draft-attachment')).toHaveLength(2);
  });

  test('mobile-camera-c3: web activation still opens the document picker directly', async () => {
    // Regression caught: showing a native choice menu on web breaks Playwright's
    // direct file-chooser event; the no-alert assertion fails.
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    const screen = renderChat();

    await act(async () => fireEvent.press(screen.getByTestId('chat-attachment-button')));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1);
  });

  test('mobile-camera-c4: permission denial is requestable and blocked denial opens Settings', async () => {
    // Regression caught: denied users see a dead-end camera surface; the request
    // and Settings recovery controls are both required and accessible.
    mockCameraPermission = { canAskAgain: true, granted: false, status: 'denied' };
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');

    fireEvent.press(screen.getByTestId('camera-permission-request'));
    expect(screen.getByTestId('camera-permission-request')).toHaveProp(
      'accessibilityLabel',
      'Allow camera access',
    );
    expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);

    mockCameraPermission = { canAskAgain: false, granted: false, status: 'denied' };
    screen.rerender(<PaperProvider><ChatView /></PaperProvider>);
    fireEvent.press(screen.getByTestId('camera-permission-settings'));
    expect(screen.getByTestId('camera-permission-settings')).toHaveProp(
      'accessibilityLabel',
      'Open system settings',
    );
    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  });

  test('mobile-camera-c5: one capture adds the JPEG draft shape and sends through the existing pipeline', async () => {
    // Regression caught: capture bypasses draft attachments or invokes the
    // camera twice; the exact call count, draft shape, and send payload fail.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-26T14:05:06.000Z'));
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');

    await act(async () => fireEvent.press(screen.getByTestId('camera-capture-button')));

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('draft-attachment').props.children).toBe(
      'Photo 2026-09-26 14-05-06.jpg|image/jpeg|file:///camera/capture.jpg',
    );
    expect(screen.queryByTestId('mock-camera-view')).toBeNull();

    await act(async () => fireEvent.press(screen.getByLabelText('Send message')));
    expect(mockSendPrompt).toHaveBeenCalledWith(
      'session-1',
      '',
      [{
        filename: 'Photo 2026-09-26 14-05-06.jpg',
        mime: 'image/jpeg',
        uri: 'file:///camera/capture.jpg',
      }],
    );
  });

  test('mobile-camera-c6: oversized captures stay recoverable and visible in the camera', async () => {
    // Regression caught: an oversized camera file is attached or closes the
    // camera; the limit error and still-open camera assertions fail.
    mockCapturedFileSize = MOBILE_ATTACHMENT_LIMIT_BYTES + 1;
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');

    await act(async () => fireEvent.press(screen.getByTestId('camera-capture-button')));

    expect(screen.queryAllByTestId('draft-attachment')).toHaveLength(0);
    expect(screen.getByText('Photo exceeds the 10 MB attachment limit.')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Photo exceeds the 10 MB attachment limit.',
    );
    expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
    expect(screen.getByTestId('camera-close-button')).toHaveProp(
      'accessibilityLabel',
      'Close camera',
    );
  });

  test('mobile-camera-c7: permission loading remains closable without animation', async () => {
    // Regression caught: permission hydration leaves a blank modal with no
    // escape path; loading copy and the stable close target both fail.
    mockCameraPermission = null;
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');

    expect(screen.getByTestId('camera-permission-loading')).toBeTruthy();
    expect(screen.getByText('Checking camera access…')).toBeTruthy();
    fireEvent.press(screen.getByTestId('camera-close-button'));
    expect(screen.queryByTestId('camera-permission-loading')).toBeNull();
  });

  test('mobile-camera-c8: duplicate camera URIs are not added twice', async () => {
    // Regression caught: camera attachments bypass the existing URI guard;
    // reopening and capturing the same cache URI renders a duplicate row.
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');
    await act(async () => fireEvent.press(screen.getByTestId('camera-capture-button')));
    await pressNativeAttachmentChoice(screen, 'Take Photo');
    await act(async () => fireEvent.press(screen.getByTestId('camera-capture-button')));

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('draft-attachment')).toHaveLength(1);
  });

  test('mobile-camera-c9: returning active after Settings refreshes blocked permission once and removes the listener', async () => {
    // Regression caught: granting camera access in Settings leaves the blocked
    // screen mounted until the whole sheet is closed and reopened.
    mockCameraPermission = { canAskAgain: false, granted: false, status: 'denied' };
    const granted = { canAskAgain: true, granted: true, status: 'granted' } as const;
    mockGetCameraPermission.mockResolvedValue(granted);
    let onAppStateChange: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      onAppStateChange = listener;
      return { remove };
    });
    const screen = renderChat();
    await pressNativeAttachmentChoice(screen, 'Take Photo');
    fireEvent.press(screen.getByTestId('camera-permission-settings'));
    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));

    await act(async () => onAppStateChange?.('active'));

    await waitFor(() => expect(screen.getByTestId('mock-camera-view')).toBeTruthy());
    expect(mockGetCameraPermission).toHaveBeenCalledTimes(1);
    await act(async () => onAppStateChange?.('active'));
    expect(mockGetCameraPermission).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('camera-close-button'));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
