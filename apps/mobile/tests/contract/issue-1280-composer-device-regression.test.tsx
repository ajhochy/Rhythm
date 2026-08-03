import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatComposer } from '@/components/chat/chat-composer';
import { Colors } from '@/constants/theme';

const MIN_INPUT_HEIGHT = 24;
const MAX_INPUT_HEIGHT = 132;

function ComposerHarness() {
  const [draft, setDraft] = useState('');

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

describe('issue #1280 native composer regression contract', () => {
  afterEach(cleanup);

  test('issue-1280-c1: multiline typing delegates height growth to native layout without a synthetic content-size event', () => {
    // Regression caught: a fixed 24pt height prevents Fabric from relaying the
    // content-size event that the JS resize path is waiting for.
    const screen = render(<ComposerHarness />);
    const input = screen.getByTestId('chat-prompt-input');

    fireEvent.changeText(input, 'one\ntwo\nthree');

    expect(inputStyle(input)?.height).toBeUndefined();
    expect(inputStyle(input)?.minHeight).toBe(MIN_INPUT_HEIGHT);
  });

  test('issue-1280-c2: a long draft keeps the intrinsic 132pt cap and native scrolling without a synthetic content-size event', () => {
    // Regression caught: replacing intrinsic measurement with a fixed height
    // leaves long drafts one line tall even though scrolling remains enabled.
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
});
