import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { Children, Fragment, isValidElement } from 'react';
import { StyleSheet } from 'react-native';
import { Dialog, List, PaperProvider } from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { normalizeProfileIcon } from '@/components/ui/profile-icon';
import { Colors, Spacing, TypeScale } from '@/constants/theme';
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

  test('explains why Create is disabled when no selectable profile exists', () => {
    const screen = render(
      sheet([], defaultChatPreferences, jest.fn()),
    );

    expect(
      screen.getByText(
        'No selectable profile available — enable one in Profiles',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Create' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  test('task-mobile-chat-list-polish-nc3: sheet is visible with Create disabled before the profile catalog resolves, then enables once it arrives', async () => {
    // Regression caught (NC-3): openCreateSheet no longer awaits loadSessionProfiles, so the
    // sheet mounts with an empty catalog first. Create must stay disabled through that window
    // and only enable once profiles populate the SAME already-open sheet (no remount/visible flip).
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const screen = render(
      sheet([], defaultChatPreferences, onCreate),
    );

    // Sheet is visible immediately, with the loading/empty catalog, and Create is disabled.
    expect(screen.getByLabelText('Chat title')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Create' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    // Profiles resolve in the background while the sheet stays open (visible stays true).
    screen.rerender(
      sheet([secretary], defaultChatPreferences, onCreate),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Create' }).props.accessibilityState,
      ).toMatchObject({ disabled: false });
    });

    fireEvent.press(screen.getByText('Create'));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ profileId: secretary.profileId }),
      );
    });
  });

  test('task-mobile-chat-list-polish-c5: summary uses compact rows instead of nested cards', () => {
    // Regression caught: oversized nested cards push Reasoning and Approval Policy below the initial sheet viewport.
    const screen = render(
      sheet([secretary], defaultChatPreferences, jest.fn()),
    );
    const contentStyle = StyleSheet.flatten(
      screen.getByTestId('session-configuration-content').props.style,
    );

    expect(contentStyle.gap).toBeLessThanOrEqual(Spacing.x2);
    expect(contentStyle.paddingHorizontal).toBeLessThanOrEqual(Spacing.x4);
    expect(screen.getByTestId('session-profile-row')).toBeTruthy();
    expect(screen.getByTestId('session-model-row')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByLabelText('Reasoning').props.style)).toEqual(
      expect.objectContaining({ fontSize: TypeScale.footnote }),
    );
    expect(StyleSheet.flatten(screen.getByLabelText('Approval Policy').props.style)).toEqual(
      expect.objectContaining({ fontSize: TypeScale.footnote }),
    );
  });
});
