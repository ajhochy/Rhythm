import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatComposer } from '@/components/chat/chat-composer';
import { Colors } from '@/constants/theme';

const MIN_INPUT_HEIGHT = 24;
const MAX_INPUT_HEIGHT = 132;

function ComposerHarness({ initialDraft = '' }: { initialDraft?: string }) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <PaperProvider>
      <ChatComposer
        attachments={[]}
        commands={[]}
        connectionStatus="connected"
        conversation={{ active: false, isListening: false, phase: 'off' }}
        draft={draft}
        insetsBottom={0}
        isCreatingSession={false}
        isSpeechInputAvailable={false}
        isSpeechInputListening={false}
        isStoppingSession={false}
        onAttach={jest.fn()}
        onCommandSelect={jest.fn()}
        onDraftChange={setDraft}
        onRemoveAttachment={jest.fn()}
        onSend={jest.fn()}
        onToggleRecording={jest.fn()}
        palette={Colors.light}
        showSendAction
      />
    </PaperProvider>
  );
}

function inputStyle(input: ReturnType<typeof render>['getByTestId'] extends (
  testId: string,
) => infer Result
  ? Result
  : never) {
  return StyleSheet.flatten(input.props.style);
}

describe('ChatComposer native multiline sizing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    cleanup();
    jest.useRealTimers();
  });

  test('issue-5-c1: grows from 24 points through intrinsic native text layout', () => {
    // Regression caught: a fixed height prevents Fabric from relaying the
    // content-size event that the resize path is waiting for.
    const screen = render(<ComposerHarness />);
    const input = screen.getByTestId('chat-prompt-input');

    fireEvent.changeText(input, 'one\ntwo\nthree');

    expect(inputStyle(input)?.height).toBeUndefined();
    expect(inputStyle(input)?.minHeight).toBe(MIN_INPUT_HEIGHT);
  });

  test('issue-5-c2: keeps native scrolling active and caps intrinsic growth at 132 points', () => {
    // Regression caught: enabling iOS scrolling only after the cap hides the caret
    // when a paste reaches the cap before UIScrollView caret tracking is active.
    const screen = render(<ComposerHarness />);
    const input = screen.getByTestId('chat-prompt-input');

    fireEvent.changeText(
      input,
      Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n'),
    );

    expect(inputStyle(input)?.height).toBeUndefined();
    expect(inputStyle(input)?.maxHeight).toBe(MAX_INPUT_HEIGHT);
    expect(input.props.scrollEnabled).toBe(true);
  });

  test('issue-5-c4: deletion and clearing never leave a stale explicit height', () => {
    // Regression caught: retaining a JS-measured height leaves a shortened or
    // empty composer pinned to its previous size.
    const screen = render(<ComposerHarness initialDraft={'one\ntwo\nthree\nfour'} />);
    const input = screen.getByTestId('chat-prompt-input');

    fireEvent.changeText(input, 'one');
    expect(inputStyle(input)?.height).toBeUndefined();

    fireEvent.changeText(input, '');
    expect(inputStyle(input)?.height).toBeUndefined();
    expect(inputStyle(input)?.minHeight).toBe(MIN_INPUT_HEIGHT);
  });

  test('issue-5-c5: the real native input remains intrinsically sized when content-size events arrive', () => {
    // Regression caught: restoring the event-driven fixed height recreates the
    // Fabric layout/event feedback deadlock on physical iOS hardware.
    const screen = render(<ComposerHarness initialDraft={'one\ntwo'} />);
    const input = screen.getByTestId('chat-prompt-input');

    for (const contentHeight of [44, 180, 22]) {
      fireEvent(input, 'contentSizeChange', {
        nativeEvent: { contentSize: { height: contentHeight, width: 280 } },
      });
      expect(inputStyle(input)?.height).toBeUndefined();
    }
  });
});
