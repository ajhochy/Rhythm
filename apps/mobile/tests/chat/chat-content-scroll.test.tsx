import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatContent } from '@/components/chat/chat-content';
import { styles as chatViewStyles } from '@/components/chat/chat-view-styles';
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

function content(
  currentSessionId: string,
  displayTranscript: TranscriptEntry[],
  activeTab: ComponentProps<typeof ChatContent>['activeTab'] = 'session',
) {
  return (
    <PaperProvider>
      <ChatContent {...props(currentSessionId, displayTranscript)} activeTab={activeTab} />
    </PaperProvider>
  );
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('task-mobile-chat-list-polish-scroll-c1: an early top scroll cannot cancel initial bottom positioning', () => {
  // Regression caught: native onScroll reports offset 0 before content settles,
  // clearing the initial-position request before the first content-size event.
  const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const rendered = render(content('session-a', [entry('1', 'Existing message')]));
  const transcript = rendered.getByTestId('chat-transcript');

  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 0 },
      contentSize: { height: 900, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });
  fireEvent(transcript, 'contentSizeChange', 320, 900);

  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
});

test('task-mobile-chat-list-polish-scroll-c2: returning to the session tab positions the transcript at bottom', () => {
  // Regression caught: returning from Changes with the same session and message
  // count leaves the transcript at its stale position because neither changed.
  const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const transcriptEntries = [entry('1', 'Existing message')];
  const rendered = render(content('session-a', transcriptEntries));
  const transcript = rendered.getByTestId('chat-transcript');
  fireEvent(transcript, 'contentSizeChange', 320, 900);
  scrollToEnd.mockClear();
  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { height: 900, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });

  rendered.rerender(content('session-a', transcriptEntries, 'changes'));
  rendered.rerender(content('session-a', transcriptEntries));
  fireEvent(rendered.getByTestId('chat-transcript'), 'contentSizeChange', 320, 900);

  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
});

test('task-mobile-chat-list-polish-scroll-c7: prepending older messages does not override the visible anchor', () => {
  // Regression caught: when the prior transcript fits the viewport, prepending
  // older entries is mistaken for an append and scrollToEnd defeats anchor retention.
  const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const rendered = render(content('session-a', [
    entry('2', 'Previously first message'),
    entry('3', 'Previously last message'),
  ]));
  const transcript = rendered.getByTestId('chat-transcript');
  fireEvent(transcript, 'contentSizeChange', 320, 250);
  scrollToEnd.mockClear();
  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 0 },
      contentSize: { height: 250, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });

  rendered.rerender(content('session-a', [
    entry('1', 'Loaded older message'),
    entry('2', 'Previously first message'),
    entry('3', 'Previously last message'),
  ]));
  fireEvent(rendered.getByTestId('chat-transcript'), 'contentSizeChange', 320, 400);

  expect(scrollToEnd).not.toHaveBeenCalled();
  expect(rendered.getByTestId('chat-transcript').props.maintainVisibleContentPosition)
    .toEqual({ minIndexForVisible: 0 });

  fireEvent.scroll(rendered.getByTestId('chat-transcript'), {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { height: 400, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });
  rendered.rerender(content('session-a', [
    entry('1', 'Loaded older message'),
    entry('2', 'Previously first message'),
    entry('3', 'Previously last message'),
    entry('4', 'New appended message'),
  ]));
  fireEvent(rendered.getByTestId('chat-transcript'), 'contentSizeChange', 320, 500);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
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

test('task-chat-polish-c2: viewport changes restore bottom only for readers within 32 points', () => {
  // Regression caught: keyboard/composer layout changes either hide the last
  // response or yank a reader away from an older transcript anchor.
  const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
  const rendered = render(content('session-a', [entry('1', 'Long response')]));
  const transcript = rendered.getByTestId('chat-transcript');
  fireEvent(transcript, 'contentSizeChange', 320, 900);
  scrollToEnd.mockClear();

  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 568 },
      contentSize: { height: 900, width: 320 },
      layoutMeasurement: { height: 300, width: 320 },
    },
  });
  fireEvent(transcript, 'layout', { nativeEvent: { layout: { height: 240, width: 320, x: 0, y: 0 } } });
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });

  scrollToEnd.mockClear();
  fireEvent.scroll(transcript, {
    nativeEvent: {
      contentOffset: { x: 0, y: 300 },
      contentSize: { height: 900, width: 320 },
      layoutMeasurement: { height: 240, width: 320 },
    },
  });
  fireEvent(transcript, 'layout', { nativeEvent: { layout: { height: 200, width: 320, x: 0, y: 0 } } });
  expect(scrollToEnd).not.toHaveBeenCalled();
  expect(transcript.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
});

test('task-chat-polish-c2-geometry: transcript uses centered 16 point insets, 20 point turns, and a compact loader', () => {
  // Regression caught: the pagination control becomes a teal card with a large
  // empty gap, or Pro Max transcripts grow wider than the readable measure.
  const rendered = render(
    <PaperProvider>
      <ChatContent {...props('session-a', [entry('1', 'First')])} hasOlderMessages />
    </PaperProvider>,
  );
  expect(StyleSheet.flatten(chatViewStyles.content)).toEqual(expect.objectContaining({
    alignSelf: 'center',
    maxWidth: 422,
    paddingHorizontal: 16,
    width: '100%',
  }));
  expect(chatViewStyles.transcriptItem.marginBottom).toBe(20);
  expect(chatViewStyles.paginationRow).toEqual(expect.objectContaining({ height: 44, marginBottom: 8 }));
  expect(rendered.getByText('Load earlier messages')).toBeTruthy();
});

test('mobile-chat-ui-c8: completed idle tasks disappear while active progress stays inline and expandable', () => {
  // Regression caught: a finished task summary remains as standalone chrome,
  // or active task progress returns to an overlay that obscures the transcript.
  const complete = [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'completed' },
  ] as never;
  const rendered = render(
    <PaperProvider>
      <ChatContent {...props('session-a', [entry('1', 'Done')])} currentTodos={complete} />
    </PaperProvider>,
  );
  expect(rendered.queryByText('2 of 2 tasks completed')).toBeNull();

  rendered.rerender(
    <PaperProvider>
      <ChatContent
        {...props('session-a', [entry('1', 'Working')])}
        currentTodos={[
          { content: 'One', status: 'completed' },
          { content: 'Two', status: 'in_progress' },
        ] as never}
        running
      />
    </PaperProvider>,
  );
  expect(rendered.getByText('1 of 2 tasks completed')).toBeTruthy();
  fireEvent.press(rendered.getByRole('button', { name: 'Expand tasks' }));
  expect(rendered.getByText('Two')).toBeTruthy();
  expect(chatViewStyles.todoHeader.minHeight).toBeLessThanOrEqual(44);
  expect(StyleSheet.flatten(chatViewStyles.todoInline)).not.toHaveProperty('position');
});

test('task-chat-polish-c7: a pending decision hides even an expanded todo panel', () => {
  // Regression caught: an expanded todo panel remains between the transcript
  // and a blocking assistant question, pushing the decision actions offscreen.
  const activeTodos = [
    { content: 'Finished setup', status: 'completed' },
    { content: 'Waiting task', status: 'in_progress' },
  ] as never;
  const rendered = render(
    <PaperProvider>
      <ChatContent
        {...props('session-a', [entry('1', 'Need a decision')])}
        currentTodos={activeTodos}
        running
      />
    </PaperProvider>,
  );
  fireEvent.press(rendered.getByRole('button', { name: 'Expand tasks' }));
  expect(rendered.getByText('Waiting task')).toBeTruthy();

  rendered.rerender(
    <PaperProvider>
      <ChatContent
        {...props('session-a', [entry('1', 'Need a decision')])}
        currentPendingQuestions={[{
          id: 'question-1',
          sessionID: 'session-a',
          questions: [{
            custom: false,
            header: 'Choose one',
            multiple: false,
            options: [{ label: 'Continue' }],
            question: 'Proceed?',
          }],
        }] as never}
        currentTodos={activeTodos}
        pendingInteractions={1}
        running
      />
    </PaperProvider>,
  );

  expect(rendered.getByRole('radio', { name: 'Continue' })).toBeTruthy();
  expect(rendered.getByText('Submit answer')).toBeTruthy();
  expect(rendered.queryByText('Waiting task')).toBeNull();
  expect(rendered.queryByText('1 of 2 tasks completed')).toBeNull();
});
