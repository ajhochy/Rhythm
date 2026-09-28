import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { IconButton as PaperIconButton, PaperProvider } from 'react-native-paper';

import { ChatComposer } from '@/components/chat/chat-composer';
import { styles as chatViewStyles } from '@/components/chat/chat-view-styles';
import { Colors } from '@/constants/theme';

const MIN_INPUT_HEIGHT = 24;
const MAX_INPUT_HEIGHT = 84;

function ComposerHarness({
  attachments = [],
  contextLabel,
  initialDraft = '',
}: {
  attachments?: { filename?: string; mime?: string; uri: string }[];
  contextLabel?: string;
  initialDraft?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <PaperProvider>
      <ChatComposer
        attachments={attachments}
        commands={[]}
        connectionStatus="connected"
        conversation={{ active: false, isListening: false, phase: 'off' }}
        contextLabel={contextLabel}
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

  test('issue-5-c2: keeps native scrolling active and caps intrinsic growth inside the 92 point dock', () => {
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

  test('task-ios-mobile-ui-c4: attachment, dictation, and send keep distinct labels and stable positions', () => {
    // Regression caught: icon-only controls swap meaning while retaining the same unnamed target.
    const screen = render(<ComposerHarness initialDraft="Keep this draft" />);

    expect(screen.getByLabelText('Add attachment')).toBeTruthy();
    expect(screen.getByLabelText('Start dictation')).toBeTruthy();
    expect(screen.getByLabelText('Send message')).toBeTruthy();
    expect(screen.getByTestId('chat-attachment-button')).toBeTruthy();
    expect(screen.getByTestId('chat-dictation-button')).toBeTruthy();
    expect(screen.getByTestId('chat-send-button')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toHaveProp('multiline', true);
  });

  test('task-chat-polish-c4: one dock holds all controls and meets keyboard geometry', () => {
    // Regression caught: metadata and keyboard/mic rows stack above the input,
    // making the keyboard-visible composer substantially taller than 56 points.
    let showKeyboard: (() => void) | undefined;
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
      if (event === 'keyboardDidShow') showKeyboard = () => listener({} as never);
      return { remove: jest.fn() } as never;
    });
    const screen = render(<ComposerHarness />);
    expect(screen.queryByLabelText('Dismiss keyboard')).toBeNull();

    act(() => showKeyboard?.());
    expect(screen.getByLabelText('Dismiss keyboard')).toBeTruthy();
    expect(screen.queryByText('Build · Model')).toBeNull();

    const composer = StyleSheet.flatten(screen.getByTestId('chat-composer').props.style);
    expect(chatViewStyles.inputShell.minHeight + composer.paddingTop + composer.paddingBottom).toBeLessThanOrEqual(56);
    expect(composer.paddingBottom).toBe(4);
    expect(chatViewStyles.inputShell.maxHeight).toBe(92);
    expect(chatViewStyles.inputShell.borderRadius).toBeGreaterThanOrEqual(20);
    expect(chatViewStyles.inputShell.borderRadius).toBeLessThanOrEqual(24);
    for (const label of ['Add attachment', 'Dismiss keyboard', 'Start dictation', 'Send message']) {
      const control = screen.UNSAFE_getAllByType(PaperIconButton).find(
        (button) => button.props.accessibilityLabel === label,
      );
      expect(StyleSheet.flatten(control?.props.style)).toEqual(expect.objectContaining({ height: 44, width: 44 }));
    }
  });

  test('task-chat-polish-c5: attachment chips fit two-up in a 48 point strip and never display a URI', () => {
    // Regression caught: attachment chips wrap vertically or reveal a private
    // native URI when image-picker cannot supply a filename.
    const screen = render(<ComposerHarness attachments={[
      { filename: 'one.jpg', mime: 'image/jpeg', uri: 'file:///private/one.jpg' },
      { filename: 'two.pdf', mime: 'application/pdf', uri: 'file:///private/two.pdf' },
      { mime: 'image/png', uri: 'file:///private/secret-library-id' },
    ]} />);

    expect(screen.getByTestId('chat-attachment-strip')).toHaveProp('horizontal', true);
    expect(screen.getByText('Attachment')).toBeTruthy();
    expect(screen.queryByText('file:///private/secret-library-id')).toBeNull();
    expect(chatViewStyles.attachmentStrip.maxHeight).toBe(48);
    expect(chatViewStyles.attachmentChip).toEqual(expect.objectContaining({ width: 168, height: 44 }));
    expect(chatViewStyles.attachmentRow.gap).toBe(8);
    expect(168 * 2 + 8).toBeLessThanOrEqual(375 - 24);
    expect(chatViewStyles.attachmentRemoveButton).toEqual(expect.objectContaining({ height: 44, width: 44 }));
  });

  test('task-chat-polish-c4-context: composer omits duplicated profile and model metadata', () => {
    // Regression caught: profile/model context returns as a separate composer row
    // even though the same context is already visible in the header.
    const screen = render(<ComposerHarness contextLabel="Build · Model" />);
    expect(screen.queryByText('Build · Model')).toBeNull();
    expect(screen.queryByText('Message')).toBeNull();
  });

  test('task-chat-polish-c6: measured keyboard composer targets are bounded by real rows only', () => {
    // Regression caught: invisible guessed spacers or attachment wrapping make
    // one/two attachment layouts exceed the physical-device height budget.
    const dock = chatViewStyles.inputShell.maxHeight;
    const strip = chatViewStyles.attachmentStrip.maxHeight;
    const keyboardPadding = 4;
    expect(chatViewStyles.inputShell.minHeight + keyboardPadding).toBeLessThanOrEqual(56);
    expect(chatViewStyles.inputShell.minHeight + strip + keyboardPadding).toBeLessThanOrEqual(104);
    expect(dock + strip + keyboardPadding).toBeLessThanOrEqual(148);
  });
});
