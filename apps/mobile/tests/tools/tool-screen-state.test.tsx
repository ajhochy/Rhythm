import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fireEvent, render, within } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ToolScreenState } from '@/components/tools/tool-screen-state';

test('slice4-c9: tool states keep status copy separate from the recovery action', () => {
  // Regression caught: a summary container swallows its interactive recovery action into one VoiceOver stop.
  const onAction = jest.fn();
  const screen = render(
    <PaperProvider>
      <ToolScreenState
        actionLabel="Try again"
        onAction={onAction}
        state="version-mismatch"
      />
    </PaperProvider>,
  );

  const summary = screen.getByLabelText(
    'Rhythm desktop needs an update. This iPhone is paired, but the desktop version is not compatible. Update Rhythm on your Mac, then try again. Pairing and saved chats are unchanged.',
  );
  expect(summary.props.accessibilityRole).toBe('summary');
  expect(within(summary).queryByRole('button')).toBeNull();
  expect(screen.UNSAFE_getAllByType(MaterialCommunityIcons).some(
    (node) => node.props.name === 'shield-alert-outline',
  )).toBe(true);
  const scroll = screen.UNSAFE_getByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toEqual(
    expect.objectContaining({ flexGrow: 1, justifyContent: 'center' }),
  );
  expect(screen.getByText('This iPhone is paired, but the desktop version is not compatible. Update Rhythm on your Mac, then try again.').props.numberOfLines).toBeUndefined();
  expect(screen.getByText('Pairing and saved chats are unchanged.')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onAction).toHaveBeenCalledTimes(1);
});
