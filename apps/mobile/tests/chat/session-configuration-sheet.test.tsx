import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { Children, Fragment, isValidElement } from 'react';
import { Dialog, List, PaperProvider } from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { normalizeProfileIcon } from '@/components/ui/profile-icon';
import { Colors } from '@/constants/theme';
import {
  defaultChatPreferences,
  type AgentOption,
  type ChatPreferences,
} from '@/providers/opencode-provider-utils';

const secretary: AgentOption = {
  id: 'secretary' as AgentOption['id'],
  profileId: 'secretary' as AgentOption['profileId'],
  opencodeAgentId: 'secretary' as AgentOption['opencodeAgentId'],
  label: 'Secretary',
};

function sheet(
  profiles: AgentOption[],
  preferences: ChatPreferences,
  onCreate: jest.Mock,
) {
  return (
    <PaperProvider>
      <SessionConfigurationSheet
        availableModels={[]}
        availableProfiles={profiles}
        availableProviders={[]}
        mode="create"
        onCreate={onCreate}
        onDismiss={jest.fn()}
        palette={Colors.light}
        preferences={preferences}
        visible
      />
    </PaperProvider>
  );
}

describe('SessionConfigurationSheet', () => {
  afterEach(cleanup);

  test('keeps a typed title when profiles and preferences refresh while open', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const screen = render(
      sheet([secretary], defaultChatPreferences, onCreate),
    );
    const titleInput = screen.getByLabelText('Chat title');

    fireEvent.changeText(titleInput, 'Lifecycle proof');
    expect(screen.getByLabelText('Chat title').props.value).toBe(
      'Lifecycle proof',
    );

    screen.rerender(
      sheet(
        [{ ...secretary, description: 'Refreshed profile data' }],
        { ...defaultChatPreferences, speechRate: 1.1 },
        onCreate,
      ),
    );

    expect(screen.getByLabelText('Chat title').props.value).toBe(
      'Lifecycle proof',
    );
    fireEvent.press(screen.getByText('Create'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        'Lifecycle proof',
        expect.objectContaining({ profileId: secretary.profileId }),
      );
    });
  });

  test('normalizes server profile icons without native console warnings', () => {
    const profiles: AgentOption[] = [
      secretary,
      {
        ...secretary,
        id: 'settings' as AgentOption['id'],
        profileId: 'settings' as AgentOption['profileId'],
        label: 'Settings profile',
        display: { color: null, icon: 'settings-suggest' },
      },
      {
        ...secretary,
        id: 'doctor' as AgentOption['id'],
        profileId: 'doctor' as AgentOption['profileId'],
        label: 'Doctor profile',
        display: { color: null, icon: '🩺' },
      },
      {
        ...secretary,
        id: 'desktop' as AgentOption['id'],
        profileId: 'desktop' as AgentOption['profileId'],
        label: 'Desktop profile',
        display: { color: null, icon: 'assets/agents/opencode.png' },
      },
      {
        ...secretary,
        id: 'unknown' as AgentOption['id'],
        profileId: 'unknown' as AgentOption['profileId'],
        label: 'Unknown profile',
        display: { color: null, icon: 'server-invented-glyph' },
      },
    ];
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const screen = render(
      sheet(profiles, defaultChatPreferences, jest.fn()),
    );
    fireEvent.press(screen.getByLabelText('Profile, Secretary'));

    const icons = screen
      .UNSAFE_getAllByType(List.Icon)
      .map((icon) => icon.props.icon);
    expect(icons).toEqual(
      expect.arrayContaining([
        'cog-outline',
        'stethoscope',
        'robot-outline',
        'account-outline',
      ]),
    );
    expect(normalizeProfileIcon('settings-suggest')).toBe('cog-outline');
    expect(normalizeProfileIcon('🩺')).toBe('stethoscope');
    expect(normalizeProfileIcon('assets/agents/opencode.png')).toBe(
      'robot-outline',
    );
    expect(normalizeProfileIcon('server-invented-glyph')).toBe(
      'account-outline',
    );
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    error.mockRestore();
    warn.mockRestore();
  });

  test('renders Paper buttons instead of a Fragment in Dialog actions', () => {
    const screen = render(
      sheet([secretary], defaultChatPreferences, jest.fn()),
    );
    const actions = screen.UNSAFE_getByType(Dialog.Actions);
    const directChildren = Children.toArray(actions.props.children);

    expect(directChildren).not.toHaveLength(0);
    expect(
      directChildren.every(
        (child) => !isValidElement(child) || child.type !== Fragment,
      ),
    ).toBe(true);
  });
});
