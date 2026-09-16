import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { NativeSelect } from '@/components/ui/native-select';

test('task-ios-mobile-ui-c7: modal choices expose modal and checked semantics', () => {
  // Regression caught: VoiceOver hears choices as unrelated buttons and cannot identify the selection.
  const screen = render(
    <NativeSelect
      onValueChange={jest.fn()}
      options={[
        { label: 'Concise', sectionLabel: 'Response style', value: 'concise' },
        { label: 'Detailed', sectionLabel: 'Response style', value: 'detailed' },
      ]}
      selectedValue="concise"
      title="Response style"
      renderTrigger={({ open }) => (
        <Pressable accessibilityLabel="Response style, Concise" accessibilityRole="button" onPress={open}>
          <Text>Concise</Text>
        </Pressable>
      )}
    />,
  );

  fireEvent.press(screen.getByLabelText('Response style, Concise'));
  expect(screen.getByTestId('native-select-modal').props.accessibilityViewIsModal).toBe(true);
  expect(screen.getByRole('radio', { name: 'Concise' }).props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByRole('radio', { name: 'Detailed' }).props.accessibilityState).toMatchObject({ checked: false });
});
