import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { FlatList } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatContent } from '@/components/chat/chat-content';
import { Colors } from '@/constants/theme';
import type { TranscriptEntry } from '@/lib/opencode/format';

const noop = jest.fn();

function entry(id: string, text: string): TranscriptEntry {
  return { createdAt: Number(id), details: [], id, role: 'assistant', text };
}

function props(
  currentSessionId: string,
  displayTranscript: TranscriptEntry[],
): ComponentProps<typeof ChatContent> {
  return {
    activeTab: 'session',
    awaitingUserInput: false,
    connection: { message: 'Connected', status: 'connected' },
    currentDiffs: [],
    currentPendingPermissions: [],
    currentPendingQuestions: [],
    currentSessionId,
    currentTodos: [],
    diffCount: 0,
    diffDetails: [],
    displayTranscript,
    hasOlderMessages: false,
    isRefreshingDiffs: false,
    isRefreshingMessages: false,
    onCopyMessage: noop,
    onExpandDiff: noop,
    onForkMessage: noop,
    onLoadOlderMessages: noop,
    onRefresh: noop,
    onRejectQuestion: noop,
    onReplyToPermission: noop,
    onReplyToQuestion: noop,
    onRevertMessage: noop,
    onSendStarterPrompt: noop,
    onToggleSpeak: noop,
    onUnrevert: noop,
    palette: Colors.light,
    pendingInteractions: 0,
    running: false,
  };
}

function content(currentSessionId: string, displayTranscript: TranscriptEntry[]) {
  return (
    <PaperProvider>
      <ChatContent {...props(currentSessionId, displayTranscript)} />
    </PaperProvider>
  );
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('existing chats open at the bottom without pulling a reader back down', () => {
  const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const rendered = render(content('session-a', [entry('1', 'Existing message')]));
  const transcript = rendered.getByTestId('chat-transcript');

  expect(rendered.getByText('Existing message')).toBeTruthy();
  fireEvent(transcript, 'contentSizeChange', 320, 900);
  expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });

  scrollToEnd.mockClear();
  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { height: 900, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });
  rendered.rerender(content('session-a', [
    entry('1', 'Existing message'),
    entry('2', 'New message while reading'),
  ]));
  expect(rendered.getByText('New message while reading')).toBeTruthy();
  fireEvent(rendered.getByTestId('chat-transcript'), 'contentSizeChange', 320, 1_000);
  expect(scrollToEnd).not.toHaveBeenCalled();

  rendered.rerender(content('session-b', [entry('3', 'Different existing chat')]));
  const nextTranscript = rendered.getByTestId('chat-transcript');
  expect(rendered.getByText('Different existing chat')).toBeTruthy();
  fireEvent(nextTranscript, 'contentSizeChange', 320, 700);
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
});
