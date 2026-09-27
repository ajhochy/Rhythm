import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button as PaperButton, PaperProvider } from 'react-native-paper';

import { PendingInteractionsCard, TranscriptMessage } from '@/components/chat/chat-cards';
import { ControlButton } from '@/components/chat/chat-controls';
import { ChatHeader } from '@/components/chat/chat-header';
import { styles as chatViewStyles } from '@/components/chat/chat-view-styles';
import { Colors, MinimumTouchTarget, Radii } from '@/constants/theme';

jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));

test('question choices expose their selection mode and checked state', () => {
  // Regression caught: VoiceOver announces question choices as generic buttons without selection state.
  const screen = render(
    <PaperProvider>
      <PendingInteractionsCard
        onPermissionReply={jest.fn()}
        onQuestionReject={jest.fn()}
        onQuestionReply={jest.fn()}
        permissions={[]}
        questions={[{
          id: 'question-1',
          sessionID: 'session-1',
          questions: [
            { custom: false, header: 'Single', multiple: false, options: [{ label: 'One' }, { label: 'Two' }], question: 'Pick one' },
            { custom: false, header: 'Multiple', multiple: true, options: [{ label: 'Alpha' }, { label: 'Beta' }], question: 'Pick several' },
          ],
        } as never]}
      />
    </PaperProvider>,
  );

  const one = screen.getByRole('radio', { name: 'One' });
  const optionButton = (label: string) => screen.UNSAFE_getAllByType(PaperButton).find((button) => button.props.children === label);
  const oneButton = optionButton('One');
  expect(oneButton?.props).toEqual(expect.objectContaining({
    accessibilityRole: 'radio',
    accessibilityState: expect.objectContaining({ checked: false }),
    onPress: expect.any(Function),
  }));
  expect(oneButton?.props.disabled).not.toBe(true);
  fireEvent.press(one);
  expect(optionButton('One')?.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  const alpha = screen.getByRole('checkbox', { name: 'Alpha' });
  expect(optionButton('Alpha')?.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
  fireEvent.press(alpha);
  expect(optionButton('Alpha')?.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
});

test('chat segments keep visible state copy separate from the Changes accessible name', () => {
  // Regression caught: compact-header action wording leaks into the local segment names.
  const props = {
    availableModels: [],
    availableProfiles: [],
    availableProviders: [],
    chatPreferences: {} as never,
    connectionStatus: 'connected' as const,
    conversation: { active: false, phase: 'off' as const },
    currentSessionId: 'session-1',
    diffCount: 2,
    insetsTop: 0,
    isCreatingSession: false,
    isUsageLoading: false,
    onBack: jest.fn(),
    onCloseMenu: jest.fn(),
    onConfirmStopConversation: jest.fn(),
    onCreateSession: jest.fn(),
    onManage: jest.fn(),
    onOpenSession: jest.fn(),
    onOpenSessionMenu: jest.fn(),
    onOpenSettings: jest.fn(),
    onShowChanges: jest.fn(),
    onToggleConversationMode: jest.fn(),
    onUpdateSessionPreferences: jest.fn(async () => ({} as never)),
    palette: Colors.light,
    running: false,
    selectedSession: { id: 'session-1', title: 'Test chat' } as never,
    sessionMenuVisible: false,
    sessions: [],
    showingChanges: false,
    usage: { cost: 0, costStatus: 'free', providers: [] } as never,
  };
  const screen = render(<PaperProvider><ChatHeader {...props} /></PaperProvider>);

  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveTextContent('Chat');
  expect(screen.getByRole('tab', { name: 'Changes' })).toHaveTextContent('2 Files Changed');

  screen.rerender(<PaperProvider><ChatHeader {...props} showingChanges /></PaperProvider>);
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveTextContent('Session');
  expect(screen.getByRole('tab', { name: 'Changes' })).toHaveTextContent('2 Files Changed');

  screen.rerender(<PaperProvider><ChatHeader {...props} diffCount={0} /></PaperProvider>);
  expect(screen.getByRole('tab', { name: 'Changes' })).toHaveTextContent('Changes');
});

test('transcript icon actions have context-correct labels without changing callbacks', () => {
  // Regression caught: unlabeled icons are announced only as volume, fork, and undo.
  const onToggleSpeak = jest.fn();
  const onFork = jest.fn();
  const onRevert = jest.fn();
  const screen = render(
    <PaperProvider>
      <TranscriptMessage
        canSpeak
        entry={{ createdAt: 1, details: [], id: 'message-1', role: 'assistant', text: 'Reply' }}
        onCopy={jest.fn()}
        onFork={onFork}
        onRevert={onRevert}
        onToggleSpeak={onToggleSpeak}
      />
    </PaperProvider>,
  );

  fireEvent.press(screen.getByRole('button', { name: 'Speak assistant message' }));
  fireEvent.press(screen.getByRole('button', { name: 'Fork chat from this message' }));
  fireEvent.press(screen.getByRole('button', { name: 'Revert chat to this message' }));
  expect(onToggleSpeak).toHaveBeenCalledTimes(1);
  expect(onFork).toHaveBeenCalledTimes(1);
  expect(onRevert).toHaveBeenCalledTimes(1);

  screen.rerender(
    <PaperProvider>
      <TranscriptMessage
        canSpeak
        entry={{ createdAt: 1, details: [], id: 'message-1', role: 'assistant', text: 'Reply' }}
        onCopy={jest.fn()}
        onToggleSpeak={onToggleSpeak}
        speaking
      />
    </PaperProvider>,
  );
  expect(screen.getByRole('button', { name: 'Stop speaking assistant message' })).toBeTruthy();
});

test('reviewed chat controls retain 44 point touch targets and prototype radius', () => {
  // Regression caught: compact icon controls regress to 36–40 point targets.
  const icon = render(<ControlButton iconOnly iconName="dots-horizontal" onPress={jest.fn()}>More</ControlButton>);
  const text = render(<ControlButton onPress={jest.fn()}>Model</ControlButton>);

  expect(StyleSheet.flatten(icon.getByRole('button').props.style)).toEqual(
    expect.objectContaining({ height: MinimumTouchTarget, width: MinimumTouchTarget }),
  );
  expect(StyleSheet.flatten(text.getByRole('button').props.style)).toEqual(
    expect.objectContaining({ minHeight: MinimumTouchTarget }),
  );
  expect(StyleSheet.flatten(chatViewStyles.sessionPickerCloseButton)).toEqual(expect.objectContaining({ minHeight: MinimumTouchTarget }));
  expect(StyleSheet.flatten(chatViewStyles.attachmentRemoveButton)).toEqual(expect.objectContaining({ height: MinimumTouchTarget, width: MinimumTouchTarget }));
  expect(StyleSheet.flatten(chatViewStyles.todoToggleButton)).toEqual(expect.objectContaining({ height: MinimumTouchTarget, width: MinimumTouchTarget }));
  expect(StyleSheet.flatten(chatViewStyles.todoItemRow)).toEqual(expect.objectContaining({ minHeight: MinimumTouchTarget }));
  expect(Radii.control).toBe(10);
});
