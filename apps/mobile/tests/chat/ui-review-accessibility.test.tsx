import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button as PaperButton, Chip as PaperChip, IconButton as PaperIconButton, PaperProvider, Surface as PaperSurface, TouchableRipple as PaperTouchableRipple } from 'react-native-paper';

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
  expect(StyleSheet.flatten(oneButton?.props.style)).toEqual(expect.objectContaining({ flexBasis: '100%' }));
});

test('mobile-chat-ui-c7: permission copy is human and actions use two columns plus full-width deny', () => {
  // Regression caught: protocol slugs are title-cased as technical jargon and
  // all three decisions wrap into equally prominent compact buttons.
  const screen = render(
    <PaperProvider>
      <PendingInteractionsCard
        onPermissionReply={jest.fn()}
        onQuestionReject={jest.fn()}
        onQuestionReply={jest.fn()}
        permissions={[
          { id: 'edit', permission: 'edit', patterns: ['src/**'], sessionID: 'session-1' },
          { id: 'bash', permission: 'bash', patterns: ['npm test'], sessionID: 'session-1' },
          { id: 'other', permission: 'external_action', patterns: [], sessionID: 'session-1' },
        ] as never}
        questions={[]}
      />
    </PaperProvider>,
  );

  expect(screen.getByText('Allow OpenCode to edit files?')).toBeTruthy();
  expect(screen.getByText('Allow OpenCode to run this command?')).toBeTruthy();
  expect(screen.getByText('Allow this protected action?')).toBeTruthy();
  expect(screen.getAllByText(/OpenCode needs your approval/)).toHaveLength(3);
  const buttons = screen.UNSAFE_getAllByType(PaperButton);
  const deny = buttons.find((button) => button.props.children === 'Deny');
  const allowOnce = buttons.find((button) => button.props.children === 'Allow once');
  expect(StyleSheet.flatten(allowOnce?.props.style)).toEqual(expect.objectContaining({ flexBasis: '48%' }));
  expect(StyleSheet.flatten(deny?.props.style)).toEqual(expect.objectContaining({ flexBasis: '100%' }));
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

  expect(
    StyleSheet.flatten(chatViewStyles.header).minHeight +
    StyleSheet.flatten(chatViewStyles.chatSegmentedControl).height +
    StyleSheet.flatten(chatViewStyles.chatSegmentedControl).marginBottom,
  ).toBeLessThanOrEqual(108);
  expect(StyleSheet.flatten(chatViewStyles.header).height).toBe(52);
  expect(StyleSheet.flatten(chatViewStyles.chatSegmentedControl)).toEqual(expect.objectContaining({
    height: 44,
    marginHorizontal: 16,
  }));
  expect(StyleSheet.flatten((chatViewStyles as unknown as Record<string, object>).topTabVisual)).toEqual(expect.objectContaining({ height: 32 }));
  expect(screen.getByTestId('chat-back-button')).toHaveTextContent('‹');
  expect(StyleSheet.flatten(screen.getByTestId('chat-back-button').props.style)).toEqual(expect.objectContaining({ height: 44, width: 44 }));
});

test('mobile-chat-ui-c1: idle header omits healthy connection clutter and promotes work state', () => {
  // Regression caught: Connected/Syncing permanently consumes the subtitle
  // instead of leaving profile/model context visible while idle.
  const props = {
    availableModels: [{ id: 'provider/model', label: 'Model', providerID: 'provider', modelID: 'model' }] as never,
    availableProfiles: [{ label: 'Build', profileId: 'build' }] as never,
    availableProviders: [],
    chatPreferences: { modelId: 'provider/model', profileId: 'build' } as never,
    connectionStatus: 'connected' as const,
    conversation: { active: false, phase: 'off' as const },
    currentSessionId: 'session-1', diffCount: 0, insetsTop: 0,
    isCreatingSession: false, isUsageLoading: true,
    onBack: jest.fn(), onCloseMenu: jest.fn(), onConfirmStopConversation: jest.fn(),
    onCreateSession: jest.fn(), onManage: jest.fn(), onOpenSession: jest.fn(),
    onOpenSessionMenu: jest.fn(), onOpenSettings: jest.fn(), onShowChanges: jest.fn(),
    onToggleConversationMode: jest.fn(), onUpdateSessionPreferences: jest.fn(async () => ({} as never)),
    palette: Colors.light, running: false,
    selectedSession: { id: 'session-1', title: 'Test chat' } as never,
    sessionMenuVisible: false, sessions: [], showingChanges: false,
    usage: { cost: 0, costStatus: 'free', providers: [] } as never,
  };
  const screen = render(<PaperProvider><ChatHeader {...props} /></PaperProvider>);
  expect(screen.getByText('Build · Model')).toBeTruthy();
  expect(screen.queryByText(/Connected|Syncing/)).toBeNull();

  screen.rerender(<PaperProvider><ChatHeader {...props} presentationStatus="Working" running /></PaperProvider>);
  expect(screen.getByText('Working')).toBeTruthy();
});

test('mobile-chat-ui-c5: message actions stay behind one quiet overflow without changing callbacks', () => {
  // Regression caught: every message permanently renders a copy/speak/fork/revert toolbar.
  const onCopy = jest.fn();
  const onToggleSpeak = jest.fn();
  const onFork = jest.fn();
  const onRevert = jest.fn();
  const screen = render(
    <PaperProvider>
      <TranscriptMessage
        canSpeak
        entry={{ createdAt: 1, details: [], id: 'message-1', role: 'user', text: 'Reply' }}
        onCopy={onCopy}
        onFork={onFork}
        onRevert={onRevert}
        onToggleSpeak={onToggleSpeak}
      />
    </PaperProvider>,
  );

  expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Fork chat from this message' })).toBeNull();
  const overflow = screen.getByRole('button', { name: 'Message actions' });
  const overflowIcon = screen.UNSAFE_getAllByType(PaperIconButton).find((button) => button.props.accessibilityLabel === 'Message actions');
  expect(StyleSheet.flatten(overflowIcon?.props.style)).toEqual(expect.objectContaining({ height: MinimumTouchTarget, width: MinimumTouchTarget }));

  fireEvent.press(overflow);
  fireEvent.press(screen.getByRole('menuitem', { name: 'Copy message' }));
  fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
  fireEvent.press(screen.getByRole('menuitem', { name: 'Fork chat from this message' }));
  fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
  fireEvent.press(screen.getByRole('menuitem', { name: 'Revert chat to this message' }));
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onFork).toHaveBeenCalledTimes(1);
  expect(onRevert).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('OpenCode')).toBeNull();

  screen.rerender(
    <PaperProvider>
      <TranscriptMessage
        canSpeak
        entry={{ createdAt: 1, details: [], id: 'message-1', role: 'assistant', text: 'Reply' }}
        onCopy={onCopy}
        onToggleSpeak={onToggleSpeak}
        speaking
      />
    </PaperProvider>,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
  fireEvent.press(screen.getByRole('menuitem', { name: 'Stop speaking assistant message' }));
  expect(onToggleSpeak).toHaveBeenCalledTimes(1);
});

test('mobile-chat-ui-c6: activity is one accessible quiet disclosure with text-only expanded rows', () => {
  // Regression caught: activity returns to an outlined button plus chip/card soup.
  const screen = render(
    <PaperProvider>
      <TranscriptMessage
        entry={{
          createdAt: 1,
          details: [
            { body: 'patch', id: 'patch-1', kind: 'patch', label: 'Changed file' },
            { body: 'file', id: 'file-1', kind: 'file', label: 'File' },
          ],
          id: 'message-1',
          role: 'assistant',
          text: 'Reply',
        }}
        onCopy={jest.fn()}
        onToggleSpeak={jest.fn()}
      />
    </PaperProvider>,
  );

  const disclosure = screen.getByRole('button', { name: 'Expand activity details' });
  expect(disclosure).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
  fireEvent.press(disclosure);
  expect(screen.getByRole('button', { name: 'Collapse activity details' })).toHaveProp('accessibilityState', expect.objectContaining({ expanded: true }));
  expect(screen.getByText('Updated 1 patch')).toBeTruthy();
  expect(screen.getByText('1 file')).toBeTruthy();
  expect(screen.UNSAFE_queryAllByType(PaperChip)).toHaveLength(0);
});

test('task-chat-polish-c3: messages use document flow without assistant chrome or action gutter', () => {
  // Regression caught: assistant responses return to outlined clipped cards or
  // reserve a permanent 56 point action gutter inside every message.
  const user = render(
    <PaperProvider>
      <TranscriptMessage
        entry={{ createdAt: 1, details: [], id: 'user-1', role: 'user', text: 'Short' }}
        onCopy={jest.fn()}
        onToggleSpeak={jest.fn()}
      />
    </PaperProvider>,
  );
  const userSurface = user.UNSAFE_getAllByType(PaperSurface).find((surface) => surface.props.accessibilityLabel?.startsWith('You message'));
  const bubbleStyle = StyleSheet.flatten(userSurface?.props.style);
  expect(bubbleStyle).toEqual(expect.objectContaining({
    borderRadius: 16,
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 10,
  }));
  expect(bubbleStyle.paddingRight).toBeUndefined();
  // Compact trailing slot inside the content row: exactly one touch target wide
  // (no wider gutter), top aligned, and not an extra closed-menu row.
  expect(StyleSheet.flatten(user.getByTestId('message-actions').props.style)).toEqual(expect.objectContaining({ alignSelf: 'flex-start', height: 44, width: 44 }));
  expect(StyleSheet.flatten(user.getByTestId('message-actions').props.style).position).toBeUndefined();
  expect(StyleSheet.flatten(user.getByTestId('message-content-row').props.style)).toEqual(expect.objectContaining({ flexDirection: 'row', alignItems: 'flex-start' }));

  const assistant = render(
    <PaperProvider>
      <TranscriptMessage
        entry={{ createdAt: 1, details: [{ body: 'patch', id: 'patch-1', kind: 'patch', label: 'Changed file' }], id: 'assistant-1', role: 'assistant', text: 'Done' }}
        onCopy={jest.fn()}
        onToggleSpeak={jest.fn()}
      />
    </PaperProvider>,
  );
  const assistantSurface = assistant.UNSAFE_getAllByType(PaperSurface).find((surface) => surface.props.accessibilityLabel?.startsWith('OpenCode message'));
  const assistantStyle = StyleSheet.flatten(assistantSurface?.props.style);
  expect(assistantStyle).toEqual(expect.objectContaining({
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
    maxWidth: '100%',
    overflow: 'visible',
    paddingHorizontal: 0,
    paddingVertical: 0,
  }));
  const disclosure = assistant.UNSAFE_getAllByType(PaperTouchableRipple).find((item) => item.props.accessibilityLabel === 'Expand activity details');
  const disclosureStyle = StyleSheet.flatten(disclosure?.props.style);
  expect(disclosureStyle.height).toBeGreaterThanOrEqual(30);
  expect(disclosureStyle.height).toBeLessThanOrEqual(32);
  expect(disclosureStyle.minHeight).toBeUndefined();
  expect(disclosure?.props.hitSlop).toEqual({ bottom: 6, left: 6, right: 6, top: 6 });
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


test('enabled primary display title does not forge or rename the ordinary session', () => {
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
  const screen = render(<PaperProvider><ChatHeader {...props} displayTitle="Rhythm" /></PaperProvider>);
  expect(screen.getByText('Rhythm')).toBeTruthy();
  expect(screen.queryByText('Test chat')).toBeNull();
  expect((props.selectedSession as unknown as { title: string }).title).toBe('Test chat');
  screen.rerender(<PaperProvider><ChatHeader {...props} /></PaperProvider>);
  expect(screen.getByText('Test chat')).toBeTruthy();
  expect(screen.queryByText('Rhythm')).toBeNull();
});
