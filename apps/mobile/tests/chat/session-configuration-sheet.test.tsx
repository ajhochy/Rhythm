import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
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
});
