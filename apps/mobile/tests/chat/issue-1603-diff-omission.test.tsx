import { render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SessionDiffCard } from '@/components/chat/chat-cards';

test('issue-1603-c3: omitted patch still shows file counts and an honest preview message', () => {
  const screen = render(
    <PaperProvider>
      <SessionDiffCard
        diff={{ file: 'large.txt', patch: '', patchOmitted: 'file_too_large', additions: 800, deletions: 300 }}
        expanded
        onPress={jest.fn()}
      />
    </PaperProvider>,
  );

  expect(screen.getByText('large.txt')).toBeTruthy();
  expect(screen.getByText('+800 / -300')).toBeTruthy();
  expect(screen.getByText('Patch preview omitted to keep this session responsive; change counts are available.')).toBeTruthy();
  expect(screen.queryByText('No line changes available.')).toBeNull();
});
