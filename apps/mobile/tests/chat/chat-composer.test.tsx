import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatComposer } from '@/components/chat/chat-composer';
import { Colors } from '@/constants/theme';
import { defaultChatPreferences } from '@/providers/opencode-provider-utils';

const MIN_INPUT_HEIGHT = 24;
const MAX_INPUT_HEIGHT = 132;

function ComposerHarness({ initialDraft = '' }: { initialDraft?: string }) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <PaperProvider>
      <ChatComposer
        attachments={[]}
        availableAgents={[]}
        chatPreferences={defaultChatPreferences}
        commands={[]}
        connectionStatus="connected"
        conversation={{ active: false, isListening: false, phase: 'off' }}
        draft={draft}
        insetsBottom={0}
        isCreatingSession={false}
        isSpeechInputAvailable={false}
        isSpeechInputListening={false}
        isStoppingSession={false}
        isUpdatingAutoApprove={false}
        modelPickerGroups={[]}
        onAttach={jest.fn()}
        onCommandSelect={jest.fn()}
        onDraftChange={setDraft}
        onRemoveAttachment={jest.fn()}
        onSend={jest.fn()}
        onToggleAutoApprove={jest.fn()}
        onToggleRecording={jest.fn()}
        palette={Colors.light}
        selectedAgentLabel="Build"
        showSendAction
        updateChatPreferences={jest.fn()}
        visibleModels={[]}
      />
    </PaperProvider>
  );
}

function inputHeight(input: ReturnType<typeof render>['getByTestId'] extends (
  testId: string,
) => infer Result
  ? Result
  : never) {
  return StyleSheet.flatten(input.props.style)?.height;
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

  test('issue-5-c1: grows from 24 points using the native content size', () => {
    // Regression caught: ignoring contentSize leaves every multiline draft at one line.
    const screen = render(<ComposerHarness />);
    const input = screen.getByTestId('chat-prompt-input');

    expect(inputHeight(input)).toBe(MIN_INPUT_HEIGHT);

    fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 65.2, width: 280 } },
    });

    expect(inputHeight(input)).toBe(66);
  });

  test('issue-5-c2: keeps native scrolling active and clamps growth at 132 points', () => {
    // Regression caught: enabling iOS scrolling only after the cap hides the caret
    // when a paste reaches the cap before UIScrollView caret tracking is active.
    const screen = render(<ComposerHarness />);
    const input = screen.getByTestId('chat-prompt-input');

    expect(Platform.OS).toBe('ios');
    expect(input.props.scrollEnabled).toBe(true);

    fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 220, width: 280 } },
    });

    expect(inputHeight(input)).toBe(MAX_INPUT_HEIGHT);
    expect(input.props.scrollEnabled).toBe(true);
  });

  test('issue-5-c4: shrinks after deletion and resets after the draft is cleared', () => {
    // Regression caught: retaining a stale measured height leaves an empty composer tall.
    const screen = render(<ComposerHarness initialDraft={'one\ntwo\nthree\nfour'} />);
    const input = screen.getByTestId('chat-prompt-input');

    fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 88, width: 280 } },
    });
    expect(inputHeight(input)).toBe(88);

    fireEvent.changeText(input, 'one');
    fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 22, width: 280 } },
    });
    expect(inputHeight(input)).toBe(MIN_INPUT_HEIGHT);

    fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 88, width: 280 } },
    });
    fireEvent.changeText(input, '');
    expect(inputHeight(input)).toBe(MIN_INPUT_HEIGHT);
  });

  test('issue-5-c5: exercises growth, cap, and shrink through the Paper native event surface', () => {
    // Regression caught: a source-only test can pass without the Paper wrapper
    // forwarding native contentSize events into the rendered component.
    const screen = render(<ComposerHarness initialDraft={'one\ntwo'} />);
    const input = screen.getByTestId('chat-prompt-input');

    for (const [contentHeight, expectedHeight] of [
      [44, 44],
      [180, MAX_INPUT_HEIGHT],
      [22, MIN_INPUT_HEIGHT],
    ] as const) {
      fireEvent(input, 'contentSizeChange', {
        nativeEvent: { contentSize: { height: contentHeight, width: 280 } },
      });
      expect(inputHeight(input)).toBe(expectedHeight);
    }
  });
});
